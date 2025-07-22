import { v4 as uuidv4 } from 'uuid';
import { RedisService } from './redis';
import { OpenAIService } from './openai';
import { ChatMessage, ChatSession, Property, SearchQuery } from '../types';

export class ChatbotService {
  private redis: RedisService;
  private openai: OpenAIService;
  private isConnected = false;

  constructor() {
    this.redis = new RedisService();
    this.openai = new OpenAIService();
  }

  async connect() {
    try {
      await this.redis.connect();
      this.isConnected = true;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.isConnected = false;
    }
  }

  async disconnect() {
    if (this.isConnected) {
      await this.redis.disconnect();
      this.isConnected = false;
    }
  }

  // Main chat handler - fast path
  async handleMessage(sessionId: string, userMessage: string): Promise<string> {
    const startTime = Date.now();

    try {
      // Ensure Redis connection
      if (!this.isConnected) {
        await this.connect();
      }

      // Get or create session
      const session = await this.getOrCreateSession(sessionId);
      
      // Analyze query and search properties
      const searchQuery: SearchQuery = {
        type: 'hybrid',
        query: userMessage,
        filters: this.extractFilters(userMessage)
      };
      
      const searchResult = await this.redis.searchProperties(searchQuery);
      
      // Generate response based on search results
      const response = this.generateResponse(userMessage, searchResult.properties);
      
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
      
      // Log comprehensive metrics
      const totalTime = Date.now() - startTime;
      console.log(`🤖 CHAT METRICS:`);
      console.log(`  📝 Question: "${userMessage}"`);
      console.log(`  🔍 Filters:`, searchQuery.filters);
      console.log(`  🏠 Properties Found: ${searchResult.properties.length}`);
      console.log(`  ⚡ Redis Search: ${searchResult.latency}ms`);
      console.log(`  ⏱️  Total Time: ${totalTime}ms`);
      console.log(`  💬 Response: "${response.substring(0, 100)}${response.length > 100 ? '...' : ''}"`);
      console.log(`  📊 Session: ${sessionId} (${session.messages.length} messages)`);
      
      return response;
      
    } catch (error) {
      console.error('Chat error:', error);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  // Add property to database
  async addProperty(property: Property): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      
      await this.redis.storeProperty(property);
      console.log(`Property ${property.property_name} added successfully`);
    } catch (error) {
      console.error('Failed to add property:', error);
      throw error;
    }
  }

  // Search properties
  async searchProperties(query: string): Promise<any> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      const searchQuery: SearchQuery = {
        type: 'semantic',
        query,
        filters: this.extractFilters(query)
      };
      
      return await this.redis.searchProperties(searchQuery);
    } catch (error) {
      console.error('Search error:', error);
      return { properties: [], query: { type: 'semantic', query }, latency: 0, cacheHit: false };
    }
  }

  private async getOrCreateSession(sessionId: string): Promise<ChatSession> {
    try {
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
    } catch (error) {
      console.error('Session error:', error);
      // Return a default session if Redis fails
      return {
        id: sessionId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
  }

  private extractFilters(query: string): SearchQuery['filters'] {
    const filters: SearchQuery['filters'] = {};
    const lowerQuery = query.toLowerCase();

    // Extract bed count
    const bedMatch = lowerQuery.match(/(\d+)\s*(?:bed|bedroom)/);
    if (bedMatch) {
      filters.beds = parseInt(bedMatch[1]);
    }

    // Extract bath count
    const bathMatch = lowerQuery.match(/(\d+(?:\.\d+)?)\s*(?:bath|bathroom)/);
    if (bathMatch) {
      filters.baths = parseFloat(bathMatch[1]);
    }

    // Extract rent range with better logic - avoid matching bed/bath numbers
    const rentMatch = lowerQuery.match(/\$(\d+)(?:\s*-\s*\$?(\d+))?/);
    if (rentMatch) {
      if (lowerQuery.includes('under') || lowerQuery.includes('less than') || lowerQuery.includes('below')) {
        // "under $1500" -> max: 1500
        filters.rent = {
          max: parseInt(rentMatch[1])
        };
      } else if (lowerQuery.includes('over') || lowerQuery.includes('more than') || lowerQuery.includes('above')) {
        // "over $1500" -> min: 1500
        filters.rent = {
          min: parseInt(rentMatch[1])
        };
      } else if (rentMatch[2]) {
        // "$1000-$2000" -> min: 1000, max: 2000
        filters.rent = {
          min: parseInt(rentMatch[1]),
          max: parseInt(rentMatch[2])
        };
      } else {
        // "$1500" -> exact match
        filters.rent = {
          min: parseInt(rentMatch[1]),
          max: parseInt(rentMatch[1])
        };
      }
    }

    // Extract city
    const cities = ['portland', 'fairview', 'beaverton', 'gresham'];
    for (const city of cities) {
      if (lowerQuery.includes(city)) {
        filters.city = city;
        break;
      }
    }

    // Extract pet policy
    if (lowerQuery.includes('pet') || lowerQuery.includes('dog') || lowerQuery.includes('cat')) {
      filters.pets_allowed = true;
    }

    return filters;
  }

  private generateResponse(userQuery: string, properties: Property[]): string {
    if (properties.length === 0) {
      return "I couldn't find any properties matching your criteria. Try adjusting your search terms or ask me about available properties in Portland, Fairview, or other areas.";
    }

    const propertyList = properties.slice(0, 3).map(p => 
      `• ${p.property_name}: ${p.unit_details.beds}bd/${p.unit_details.baths}ba, $${p.rental_terms.rent}/month, ${p.address.city}, ${p.unit_details.square_feet}sqft`
    ).join('\n');

    const totalCount = properties.length;
    const moreText = totalCount > 3 ? `\n\nI found ${totalCount} total properties. Would you like to see more details about any specific property?` : '';

    return `Here are some properties that match your search:\n\n${propertyList}${moreText}\n\nYou can ask me about specific details like pet policies, amenities, or availability!`;
  }
} 