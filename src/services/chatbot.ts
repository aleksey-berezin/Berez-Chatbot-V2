import { v4 as uuidv4 } from 'uuid';
import { RedisService } from './redis';
import { OpenAIService } from './openai';
import { ChatMessage, ChatSession, Property, SearchQuery } from '../types';

export class ChatbotService {
  private redis: RedisService;
  private openai: OpenAIService;

  constructor() {
    this.redis = new RedisService();
    this.openai = new OpenAIService();
  }

  async connect() {
    await this.redis.connect();
  }

  async disconnect() {
    await this.redis.disconnect();
  }

  // Main chat handler - fast path
  async handleMessage(sessionId: string, userMessage: string): Promise<string> {
    const startTime = Date.now();

    try {
      // Get or create session
      const session = await this.getOrCreateSession(sessionId);
      
      // Analyze query for hybrid search
      const searchQuery = await this.openai.analyzeQuery(userMessage);
      
      // Search properties
      const searchResult = await this.redis.search(searchQuery);
      
      // Generate response
      const response = await this.openai.generateRecommendations(
        searchResult.properties, 
        userMessage
      );

      // Update session
      await this.updateSession(sessionId, userMessage, response);

      console.log(`Response time: ${Date.now() - startTime}ms`);
      return response;

    } catch (error) {
      console.error('Chatbot error:', error);
      return "I'm having trouble processing your request. Please try again.";
    }
  }

  private async getOrCreateSession(sessionId: string): Promise<ChatSession> {
    let session = await this.redis.getSession(sessionId) as ChatSession;
    
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await this.redis.storeSession(sessionId, session);
    }
    
    return session;
  }

  private async updateSession(sessionId: string, userMessage: string, assistantResponse: string) {
    const session = await this.getOrCreateSession(sessionId);
    
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    };

    const assistantMsg: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: assistantResponse,
      timestamp: Date.now()
    };

    session.messages.push(userMsg, assistantMsg);
    session.updatedAt = Date.now();
    
    await this.redis.storeSession(sessionId, session);
  }

  // Seed sample data
  async seedSampleData() {
    const sampleProperties: Property[] = [
      {
        id: '1',
        name: 'Downtown Luxury Apartments',
        address: '123 Main St, Portland, OR',
        beds: 2,
        baths: 2,
        rent: 2500,
        available: true,
        description: 'Luxury 2-bedroom apartment in downtown Portland with city views'
      },
      {
        id: '2',
        name: 'Riverside Studios',
        address: '456 River Rd, Portland, OR',
        beds: 1,
        baths: 1,
        rent: 1500,
        available: true,
        description: 'Cozy studio apartment near the river with modern amenities'
      },
      {
        id: '3',
        name: 'Parkview Family Homes',
        address: '789 Park Ave, Portland, OR',
        beds: 3,
        baths: 2,
        rent: 3200,
        available: true,
        description: 'Spacious 3-bedroom home near parks and schools'
      }
    ];

    for (const property of sampleProperties) {
      await this.redis.storeProperty(property);
    }

    console.log('Sample data seeded');
  }
} 