import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { ChatbotService } from './services/chatbot';
import { RedisService } from './services/redis';
import { DataLoader } from './utils/data-loader';
import { config } from './config';
import { v4 as uuidv4 } from 'uuid';

const app = new Hono();
const chatbot = new ChatbotService();
const redis = new RedisService();

// Middleware
app.use('*', cors());
app.use('*', async (c, next) => {
  console.log(`${c.req.method} ${c.req.url}`);
  await next();
});

// Serve static files from public directory
app.use('/*', serveStatic({ root: './public' }));

// Health check
app.get('/', (c) => c.json({ status: 'ok', region: config.server.region }));

// Performance monitoring endpoint
app.get('/performance', (c) => {
  const stats = chatbot.getPerformanceStats();
  return c.json(stats);
});

// Redis connection test
app.get('/test-redis', async (c) => {
  try {
    await redis.connect();
    const isConnected = await redis.testConnection();
    
    // Test property search
    let propertyCount = 0;
    try {
      const keys = await redis.getAllPropertyKeys();
      propertyCount = keys.length;
    } catch (error) {
      console.error('Keys error:', error);
    }
    
    await redis.disconnect();
    
    return c.json({ 
      connected: isConnected,
      propertyCount,
      message: isConnected ? 'Redis Cloud connected!' : 'Redis Cloud connection failed'
    });
  } catch (error) {
    return c.json({ 
      connected: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// Load real estate data
app.post('/load-data', async (c) => {
  try {
    await redis.connect();
    
    // Load real data only
    const realData = await DataLoader.loadAllData();
    if (realData.length > 0) {
      await redis.loadSampleData(realData);
    }
    
    await redis.disconnect();
    
    return c.json({ 
      success: true, 
      message: `Loaded ${realData.length} real properties`,
      realData: realData.length
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// Clean up sample data
app.post('/cleanup-data', async (c) => {
  try {
    await redis.connect();
    
    const removedCount = await redis.removeSampleData();
    
    await redis.disconnect();
    
    return c.json({ 
      success: true, 
      message: `Removed ${removedCount} sample properties`,
      removedCount
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// Clean up null entries
app.post('/cleanup-null', async (c) => {
  try {
    await redis.connect();
    
    const removedCount = await redis.removeNullEntries();
    
    await redis.disconnect();
    
    return c.json({ 
      success: true, 
      message: `Removed ${removedCount} null/empty entries`,
      removedCount
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// Chat endpoint
app.post('/chat', async (c) => {
  try {
    const { message, sessionId = 'default' } = await c.req.json();
    
    if (!message) {
      return c.json({ error: 'Message is required' }, 400);
    }

    // Get response from chatbot
    const response = await chatbot.handleMessage(sessionId, message);
    
    return c.json({
      response,
      sessionId,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('❌ Chat error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Streaming chat endpoint
app.post('/chat/stream', async (c) => {
  try {
    const { message, sessionId = 'default' } = await c.req.json();
    if (!message) {
      return c.json({ error: 'Message is required' }, 400);
    }

    // Set SSE headers
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('Access-Control-Allow-Origin', '*');

    const stream = await chatbot.handleMessageStream(sessionId, message);
    let fullResponse = '';

    // Create a readable stream
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) {
              fullResponse += content;
              const data = `data: ${JSON.stringify({ content, done: false })}\n\n`;
              controller.enqueue(new TextEncoder().encode(data));
              
              // Add a small delay to make streaming more visible
              await new Promise(resolve => setTimeout(resolve, 30)); // 30ms delay for faster streaming
            }
          }

          // Send completion signal
          const completionData = `data: ${JSON.stringify({ content: '', done: true, fullResponse })}\n\n`;
          controller.enqueue(new TextEncoder().encode(completionData));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));

          // Update session with full response
          try {
            const session = await chatbot['redis'].getSession(sessionId);
            if (session) {
              session.messages.push({
                id: uuidv4(),
                role: 'user',
                content: message,
                timestamp: Date.now()
              });
              session.messages.push({
                id: uuidv4(),
                role: 'assistant',
                content: fullResponse,
                timestamp: Date.now()
              });
              session.updatedAt = Date.now();
              await chatbot['redis'].storeSession(session);
            }
          } catch (error) {
            console.error('Failed to update session:', error);
          }

        } catch (error) {
          console.error('Streaming chat error:', error);
          const errorData = `data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`;
          controller.enqueue(new TextEncoder().encode(errorData));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    console.error('Streaming chat error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Test chat with logging
app.post('/test-chat', async (c) => {
  try {
    const { message } = await c.req.json();
    
    console.log('\n🧪 TESTING CHAT WITH LOGGING:');
    console.log('='.repeat(50));
    
    const response = await chatbot.handleMessage('test-session', message);
    
    console.log('='.repeat(50));
    console.log('✅ TEST COMPLETE\n');
    
    return c.json({ 
      success: true, 
      response,
      sessionId: 'test-session'
    });
  } catch (error) {
    return c.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, 500);
  }
});

// Properties endpoint
app.post('/properties', async (c) => {
  try {
    const property = await c.req.json();
    await chatbot.addProperty(property);
    return c.json({ success: true });
  } catch (error) {
    console.error('Property error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Search properties endpoint
app.get('/properties', async (c) => {
  try {
    const query = c.req.query('q') || '';
    const results = await chatbot.searchProperties(query);
    return c.json(results);
  } catch (error) {
    console.error('Search error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Performance monitoring endpoint
app.get('/performance', async (c) => {
  try {
    const stats = chatbot.getPerformanceStats();
    return c.json({
      success: true,
      performance: stats,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('❌ Performance stats error:', error);
    return c.json({ error: 'Failed to get performance stats' }, 500);
  }
});

// Network latency testing endpoint
app.get('/network-test', async (c) => {
  try {
    const results = {
      timestamp: Date.now(),
      redis: { connected: false, latency: 0 },
      openai: { connected: false, latency: 0 }
    };

    // Test Redis latency
    try {
      const redisStart = Date.now();
      const redisConnected = await chatbot.getRedisService().testConnection();
      results.redis = {
        connected: redisConnected,
        latency: Date.now() - redisStart
      };
    } catch (error) {
      console.error('❌ Redis test failed:', error);
    }

    // Test OpenAI latency (simple ping)
    try {
      const openaiStart = Date.now();
      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          'Authorization': `Bearer ${config.openai.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      results.openai = {
        connected: response.ok,
        latency: Date.now() - openaiStart
      };
    } catch (error) {
      console.error('❌ OpenAI test failed:', error);
    }

    return c.json({
      success: true,
      network: results
    });
  } catch (error) {
    console.error('❌ Network test error:', error);
    return c.json({ error: 'Network test failed' }, 500);
  }
});

// Start server
const port = config.server.port;
console.log(`🚀 Server running on port ${port} in ${config.server.region} region`);

serve({
  fetch: app.fetch,
  port
}); 