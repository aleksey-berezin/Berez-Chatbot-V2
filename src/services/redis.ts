import { createClient } from 'redis';
import { config } from '../config';
import { Property, SearchQuery, SearchResult } from '../types';

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
    await this.client.json.set(`property:${property.id}`, '$', property);
  }

  async getProperty(id: string): Promise<Property | null> {
    const data = await this.client.json.get(`property:${id}`);
    return data as Property | null;
  }

  // Vector storage for semantic search
  async storeEmbedding(id: string, embedding: number[]) {
    await this.client.json.set(`property:${id}`, '$.embedding', embedding);
  }

  // Hybrid search implementation
  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    
    if (query.type === 'exact' && query.filters) {
      return this.exactSearch(query);
    } else if (query.type === 'semantic') {
      return this.semanticSearch(query);
    } else {
      return this.hybridSearch(query);
    }
  }

  private async exactSearch(query: SearchQuery): Promise<SearchResult> {
    const filters = query.filters!;
    const pattern = `property:*`;
    const keys = await this.client.keys(pattern);
    const properties: Property[] = [];

    for (const key of keys) {
      const property = await this.client.json.get(key) as Property;
      if (this.matchesFilters(property, filters)) {
        properties.push(property);
      }
    }

    return {
      properties,
      query,
      latency: Date.now() - Date.now(),
      cacheHit: false
    };
  }

  private async semanticSearch(query: SearchQuery): Promise<SearchResult> {
    // Vector similarity search - simplified for MVP
    const pattern = `property:*`;
    const keys = await this.client.keys(pattern);
    const properties: Property[] = [];

    for (const key of keys) {
      const property = await this.client.json.get(key) as Property;
      // Simple text matching for MVP - will be enhanced with embeddings
      if (property.description?.toLowerCase().includes(query.query.toLowerCase()) ||
          property.name.toLowerCase().includes(query.query.toLowerCase())) {
        properties.push(property);
      }
    }

    return {
      properties,
      query,
      latency: Date.now() - Date.now(),
      cacheHit: false
    };
  }

  private async hybridSearch(query: SearchQuery): Promise<SearchResult> {
    const [exactResults, semanticResults] = await Promise.all([
      this.exactSearch(query),
      this.semanticSearch(query)
    ]);

    // Combine and rank results
    const combined = [...exactResults.properties, ...semanticResults.properties];
    const unique = this.deduplicate(combined);

    return {
      properties: unique,
      query,
      latency: Date.now() - Date.now(),
      cacheHit: false
    };
  }

  private matchesFilters(property: Property, filters: Partial<Property>): boolean {
    return Object.entries(filters).every(([key, value]) => 
      property[key as keyof Property] === value
    );
  }

  private deduplicate(properties: Property[]): Property[] {
    const seen = new Set();
    return properties.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  // Session management
  async storeSession(sessionId: string, data: any) {
    await this.client.json.set(`session:${sessionId}`, '$', data);
  }

  async getSession(sessionId: string) {
    return await this.client.json.get(`session:${sessionId}`);
  }
} 