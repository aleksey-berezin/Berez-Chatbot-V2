import { createClient } from 'redis';
import OpenAI from 'openai';

let redisClient = null;
let openaiClient = null;
let servicesConnected = false;

// Test Redis connection
async function testRedisConnection() {
  try {
    if (!redisClient) {
      redisClient = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379'
      });
      await redisClient.connect();
    }
    await redisClient.set('test', 'ok');
    const result = await redisClient.get('test');
    await redisClient.del('test');
    return result === 'ok';
  } catch (error) {
    console.error('Redis connection failed:', error);
    return false;
  }
}

// Test OpenAI connection
async function testOpenAIConnection() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OpenAI API key not found');
      return false;
    }

    if (!openaiClient) {
      openaiClient = new OpenAI({
        apiKey: apiKey
      });
    }
    
    // Test with a simple completion using the latest API
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "test"' }],
      max_tokens: 10,
      temperature: 0
    });
    
    const content = response.choices[0]?.message?.content;
    return content && content.toLowerCase().includes('test');
  } catch (error) {
    console.error('OpenAI connection failed:', error.message);
    return false;
  }
}

export default async (req, res) => {
  try {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Health check endpoint
    if (req.method === 'GET') {
      // Test connections
      const redisConnected = await testRedisConnection();
      const openaiConnected = await testOpenAIConnection();
      servicesConnected = redisConnected && openaiConnected;

      return res.status(200).json({
        status: 'ok',
        message: 'Berez Chatbot API',
        timestamp: new Date().toISOString(),
        vercelRegion: process.env.VERCEL_REGION || 'unknown',
        nodeVersion: process.version,
        servicesConnected,
        redisConnected,
        openaiConnected,
        openaiKeyPresent: !!process.env.OPENAI_API_KEY,
        openaiKeyLength: process.env.OPENAI_API_KEY?.length || 0
      });
    }

    // Chat endpoint
    if (req.method === 'POST') {
      let body = {};
      
      // Handle different ways the body might be available
      if (typeof req.body === 'string') {
        try {
          body = JSON.parse(req.body);
        } catch (e) {
          return res.status(400).json({ error: 'Invalid JSON' });
        }
      } else if (req.body) {
        body = req.body;
      }

      const { message, sessionId = 'default' } = body;
      
      if (!message) {
        return res.status(400).json({ error: 'Message is required' });
      }

      let response;

      // Try to use OpenAI for intelligent responses
      if (await testOpenAIConnection()) {
        try {
          const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a helpful real estate assistant. Provide brief, helpful responses about real estate topics. Keep responses under 100 words.'
              },
              {
                role: 'user',
                content: message
              }
            ],
            max_tokens: 150,
            temperature: 0.7
          });
          response = completion.choices[0]?.message?.content;
        } catch (error) {
          console.error('OpenAI error:', error.message);
        }
      }

      // Fallback to basic responses if OpenAI fails
      if (!response) {
        const basicResponses = [
          "I'd be happy to help you with real estate questions! What specific information are you looking for?",
          "That's a great question about real estate. Let me help you find the information you need.",
          "I can assist you with property searches, market analysis, and neighborhood insights. What interests you?",
          "For real estate inquiries, I can provide data on properties, market trends, and local information.",
          "I'm here to help with your real estate needs. What would you like to know more about?"
        ];
        
        response = basicResponses[Math.floor(Math.random() * basicResponses.length)];
      }
      
      return res.status(200).json({
        response,
        sessionId,
        timestamp: Date.now(),
        servicesConnected: await testOpenAIConnection()
      });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Function error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}; 