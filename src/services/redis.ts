import { createClient } from 'redis';
import { config } from '../config';
import { Property, SearchQuery, SearchResult, ChatSession } from '../types';

export class RedisService {
  private client;

  constructor() {
    this.client = createClient({
      url: config.redis.url
    });
  }

  async connect() {
    await this.client.connect();
  }

  async disconnect() {
    await this.client.disconnect();
  }

  // JSON storage for exact queries
  async storeProperty(property: Property) {
    await this.client.json.set(`property:${property.id}`, '$', property as any);
  }

  async getProperty(id: string): Promise<Property | null> {
    const data = await this.client.json.get(`property:${id}`);
    return data ? (data as unknown as Property) : null;
  }

  // Vector storage for semantic search
  async storeEmbedding(id: string, embedding: number[]) {
    await this.client.json.set(`embedding:${id}`, '$', { embedding });
  }

  async getEmbedding(id: string): Promise<number[] | null> {
    const data = await this.client.json.get(`embedding:${id}`);
    return data ? (data as any).embedding : null;
  }

  // Session management
  async storeSession(session: ChatSession) {
    await this.client.json.set(`session:${session.id}`, '$', session as any);
  }

  async getSession(id: string): Promise<ChatSession | null> {
    const data = await this.client.json.get(`session:${id}`);
    return data ? (data as unknown as ChatSession) : null;
  }

  // Hybrid search implementation
  async searchProperties(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    
    if (query.type === 'exact' && query.filters) {
      // JSON-based exact search
      const keys = await this.client.keys('property:*');
      const properties: Property[] = [];
      
      for (const key of keys) {
        const data = await this.client.json.get(key);
        if (data) {
          const property = data as unknown as Property;
          if (this.matchesFilters(property, query.filters)) {
            properties.push(property);
          }
        }
      }
      
      return {
        properties,
        query,
        latency: Date.now() - startTime,
        cacheHit: false
      };
    }
    
    // Vector-based semantic search (simplified)
    const keys = await this.client.keys('property:*');
    const properties: Property[] = [];
    
    for (const key of keys.slice(0, 10)) { // Limit for MVP
      const data = await this.client.json.get(key);
      if (data) {
        const property = data as unknown as Property;
        properties.push(property);
      }
    }
    
    return {
      properties,
      query,
      latency: Date.now() - startTime,
      cacheHit: false
    };
  }

  private matchesFilters(property: Property, filters: Partial<Property>): boolean {
    return Object.entries(filters).every(([key, value]) => {
      return property[key as keyof Property] === value;
    });
  }
} 