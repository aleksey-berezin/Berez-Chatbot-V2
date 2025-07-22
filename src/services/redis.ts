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

  // Fast connection test
  async testConnection(): Promise<boolean> {
    try {
      await this.client.set('test', 'ok');
      const result = await this.client.get('test');
      await this.client.del('test');
      return result === 'ok';
    } catch {
      return false;
    }
  }

  // JSON storage for exact queries
  async storeProperty(property: Property) {
    await this.client.json.set(`property:${property.listing_urls.listing_id}`, '$', property as any);
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

  private matchesFilters(property: Property, filters: SearchQuery['filters']): boolean {
    if (!filters) return true;

    // Check beds
    if (filters.beds && property.unit_details.beds !== filters.beds) {
      return false;
    }

    // Check baths
    if (filters.baths && property.unit_details.baths !== filters.baths) {
      return false;
    }

    // Check rent range
    if (filters.rent) {
      const rent = property.rental_terms.rent;
      if (filters.rent.min && rent < filters.rent.min) return false;
      if (filters.rent.max && rent > filters.rent.max) return false;
    }

    // Check city
    if (filters.city && property.address.city.toLowerCase() !== filters.city.toLowerCase()) {
      return false;
    }

    // Check pets allowed
    if (filters.pets_allowed !== undefined && property.pet_policy.pets_allowed.allowed !== filters.pets_allowed) {
      return false;
    }

    // Check square feet range
    if (filters.square_feet) {
      const sqft = property.unit_details.square_feet;
      if (filters.square_feet.min && sqft < filters.square_feet.min) return false;
      if (filters.square_feet.max && sqft > filters.square_feet.max) return false;
    }

    return true;
  }

  // Load sample data
  async loadSampleData(properties: Property[]): Promise<void> {
    console.log(`Loading ${properties.length} properties into Redis...`);
    
    for (const property of properties) {
      await this.storeProperty(property);
    }
    
    console.log('Sample data loaded successfully!');
  }

  // Get all property keys
  async getAllPropertyKeys(): Promise<string[]> {
    return await this.client.keys('property:*');
  }

  // Remove sample data
  async removeSampleData(): Promise<number> {
    const keys = await this.getAllPropertyKeys();
    let removedCount = 0;
    
    for (const key of keys) {
      const data = await this.client.json.get(key);
      if (data && (data as any).source === 'sample') {
        await this.client.del(key);
        removedCount++;
      }
    }
    
    return removedCount;
  }

  // Remove null/empty entries
  async removeNullEntries(): Promise<number> {
    const keys = await this.getAllPropertyKeys();
    let removedCount = 0;
    
    for (const key of keys) {
      const data = await this.client.json.get(key);
      if (!data || !(data as any).property_name || !(data as any).source) {
        await this.client.del(key);
        removedCount++;
      }
    }
    
    return removedCount;
  }
} 