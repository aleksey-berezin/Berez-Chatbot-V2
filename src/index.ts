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

export default app; 