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
      const queryType = await this.openai.analyzeQuery(userMessage);
      const filters = await this.openai.extractFilters(userMessage);
      
      // Perform search
      const searchQuery: SearchQuery = {
        type: queryType,
        query: userMessage,
        filters
      };
      
      const searchResult = await this.redis.searchProperties(searchQuery);
      
      // Generate response
      const response = await this.generateResponse(userMessage, searchResult.properties);
      
      // Update session
      session.messages.push({
        id: uuidv4(),
        role: 'user',
        content: userMessage,
        timestamp: Date.now()
      });
      
      session.messages.push({
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      });
      
      session.updatedAt = Date.now();
      await this.redis.storeSession(session);
      
      return response;
      
    } catch (error) {
      console.error('Chat error:', error);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  // Add property to database
  async addProperty(property: Property): Promise<void> {
    await this.redis.storeProperty(property);
    
    // Generate and store embedding for semantic search
    const description = `${property.name} ${property.address} ${property.description || ''}`;
    const embedding = await this.openai.getEmbedding(description);
    await this.redis.storeEmbedding(property.id, embedding);
  }

  // Search properties
  async searchProperties(query: string): Promise<any> {
    const queryType = await this.openai.analyzeQuery(query);
    const filters = await this.openai.extractFilters(query);
    
    const searchQuery: SearchQuery = {
      type: queryType,
      query,
      filters
    };
    
    return await this.redis.searchProperties(searchQuery);
  }

  private async getOrCreateSession(sessionId: string): Promise<ChatSession> {
    let session = await this.redis.getSession(sessionId);
    
    if (!session) {
      session = {
        id: sessionId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await this.redis.storeSession(session);
    }
    
    return session;
  }

  private async generateResponse(userQuery: string, properties: Property[]): Promise<string> {
    if (properties.length === 0) {
      return "I couldn't find any properties matching your criteria. Try adjusting your search terms.";
    }
    
    const propertyList = properties.slice(0, 5).map(p => 
      `• ${p.name}: ${p.beds}bd/${p.baths}ba, $${p.rent}/month, ${p.address}`
    ).join('\n');
    
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a helpful real estate assistant. Provide concise, friendly responses about available properties.'
      },
      {
        role: 'user' as const,
        content: `Query: "${userQuery}"\n\nAvailable properties:\n${propertyList}\n\nProvide a helpful response about these properties.`
      }
    ];
    
    const response = await this.openai.chat(messages);
    return response.toString();
  }
} 