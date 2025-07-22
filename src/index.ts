import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { ChatbotService } from './services/chatbot';
import { config } from './config';

const app = new Hono();
const chatbot = new ChatbotService();

// Middleware
app.use('*', cors());
app.use('*', async (c, next) => {
  console.log(`${c.req.method} ${c.req.url}`);
  await next();
});

// Health check
app.get('/', (c) => c.json({ status: 'ok', region: config.server.region }));

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

// Seed data endpoint
app.post('/seed', async (c) => {
  try {
    await chatbot.seedSampleData();
    return c.json({ message: 'Sample data seeded successfully' });
  } catch (error) {
    console.error('Seed error:', error);
    return c.json({ error: 'Failed to seed data' }, 500);
  }
});

// Start server
const start = async () => {
  try {
    await chatbot.connect();
    console.log(`🚀 Server starting on port ${config.server.port}`);
    console.log(`📍 Region: ${config.server.region}`);
    
    Bun.serve({
      port: config.server.port,
      fetch: app.fetch
    });
    
    console.log(`✅ Server running at http://localhost:${config.server.port}`);
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start(); 