import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { ChatbotService } from './services/chatbot';
import { RedisService } from './services/redis';
import { DataLoader } from './utils/data-loader';
import { config } from './config';

const app = new Hono();
const chatbot = new ChatbotService();
const redis = new RedisService();

// Middleware
app.use('*', cors());
app.use('*', async (c, next) => {
  console.log(`${c.req.method} ${c.req.url}`);
  await next();
});

// Health check
app.get('/', (c) => c.json({ status: 'ok', region: config.server.region }));

// Redis connection test
app.get('/test-redis', async (c) => {
  try {
    await redis.connect();
    const isConnected = await redis.testConnection();
    await redis.disconnect();
    
    return c.json({ 
      connected: isConnected,
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
    
    // Load sample data first
    const sampleData = DataLoader.generateSampleData();
    await redis.loadSampleData(sampleData);
    
    // Try to load real data
    const realData = await DataLoader.loadAllData();
    if (realData.length > 0) {
      await redis.loadSampleData(realData);
    }
    
    await redis.disconnect();
    
    return c.json({ 
      success: true, 
      message: `Loaded ${sampleData.length + realData.length} properties`,
      sampleData: sampleData.length,
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

    const response = await chatbot.handleMessage(sessionId, message);
    
    return c.json({
      response,
      sessionId,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error('Chat error:', error);
    return c.json({ error: 'Internal server error' }, 500);
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

// Start server
const port = config.server.port;
console.log(`🚀 Server running on port ${port} in ${config.server.region} region`);

serve({
  fetch: app.fetch,
  port
}); 