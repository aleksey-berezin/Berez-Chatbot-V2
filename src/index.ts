import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { ChatbotService } from './services/chatbot';
import { RedisService } from './services/redis';
import { OpenAIService } from './services/openai';
import { Logger } from './utils/logger';
import { config } from './config';

// Extend Hono context to include sessionId
type AppContext = {
  Variables: {
    sessionId: string;
  };
};

const app = new Hono<AppContext>();

// Security and performance middleware
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://localhost:5000', 'https://berez-chatbot.vercel.app'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Session-ID'],
  credentials: true
}));

// Serve static files from public directory
app.use('/*', serveStatic({ root: './public' }));

// app.use('*', logger); // Temporarily disabled due to TypeScript issues

// Rate limiting middleware
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60 * 1000; // 1 minute

app.use('/api/*', async (c, next) => {
  const sessionId = c.req.header('X-Session-ID') || 'anonymous';
  const now = Date.now();
  
  const userLimit = rateLimitMap.get(sessionId);
  if (userLimit && now < userLimit.resetTime) {
    if (userLimit.count >= RATE_LIMIT) {
      return c.json({ error: 'Rate limit exceeded. Please wait before sending another message.' }, 429);
    }
    userLimit.count++;
  } else {
    rateLimitMap.set(sessionId, { count: 1, resetTime: now + RATE_WINDOW });
  }
  
  await next();
});

// Session management middleware
app.use('/api/*', async (c, next) => {
  const sessionId = c.req.header('X-Session-ID') || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  c.set('sessionId', sessionId);
  
  // Set session ID in response headers for frontend
  c.header('X-Session-ID', sessionId);
  
  await next();
});

// Initialize services
const redis = new RedisService();
const openai = new OpenAIService();
const chatbot = new ChatbotService();

// Health check
app.get('/', (c) => {
  return c.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: ['streaming', 'session-management', 'rate-limiting', 'langcache']
  });
});

// Chat endpoint with streaming
app.post('/api/chat/stream', async (c) => {
  try {
    const { message } = await c.req.json();
    const sessionId = c.get('sessionId');
    
    if (!message || typeof message !== 'string') {
      return c.json({ error: 'Message is required' }, 400);
    }

    Logger.info(`Streaming chat request | sessionId=${sessionId} | message="${message}"`);
    
    const stream = await chatbot.handleMessageStream(sessionId, message);
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Session-ID': sessionId
      }
    });
  } catch (error) {
    Logger.error(`Streaming chat error: ${error}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Regular chat endpoint
app.post('/api/chat', async (c) => {
  try {
    const { message } = await c.req.json();
    const sessionId = c.get('sessionId');
    
    if (!message || typeof message !== 'string') {
      return c.json({ error: 'Message is required' }, 400);
    }

    Logger.info(`Chat request | sessionId=${sessionId} | message="${message}"`);
    
    const response = await chatbot.handleMessage(message, sessionId);
    return c.json({ 
      response,
      sessionId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    Logger.error(`Chat error: ${error}`);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Session management endpoints
app.get('/api/session/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  try {
    const sessionData = await redis.getSessionData(sessionId);
    return c.json({ sessionId, data: sessionData });
  } catch (error) {
    return c.json({ error: 'Session not found' }, 404);
  }
});

app.delete('/api/session/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  try {
    await redis.deleteSession(sessionId);
    return c.json({ message: 'Session deleted' });
  } catch (error) {
    return c.json({ error: 'Failed to delete session' }, 500);
  }
});

// Performance monitoring endpoint
app.get('/api/health', async (c) => {
  try {
    const redisHealth = await redis.ping();
    const openaiHealth = await openai.testConnection();
    
    return c.json({
      status: 'healthy',
      services: {
        redis: redisHealth ? 'connected' : 'disconnected',
        openai: openaiHealth ? 'connected' : 'disconnected'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return c.json({ status: 'unhealthy', error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

export default app;

// Start the server
import { serve } from '@hono/node-server';

const port = config.server.port;
console.log(`🚀 Server running on port ${port} in ${config.server.region} region`);

serve({
  fetch: app.fetch,
  port
}); 