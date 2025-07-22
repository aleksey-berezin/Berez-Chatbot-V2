import { createClient } from 'redis';
import { config } from '../config';
import { Property, SearchQuery, SearchResult, ChatSession } from '../types';

export class RedisService {
  private client;
  private vectorIndexCreated = false;
  private isConnected = false;

  constructor() {
    this.client = createClient({
      url: config.redis.url
    });
  }

  async connect() {
    if (this.isConnected) {
      console.log('🔌 Redis already connected');
      return;
    }
    
    await this.client.connect();
    this.isConnected = true;
    console.log('🔌 Redis connected successfully');
    
    // Try to create vector index on connection
    await this.createVectorIndex();
  }

  async disconnect() {
    if (!this.isConnected) {
      return;
    }
    
    await this.client.disconnect();
    this.isConnected = false;
    console.log('🔌 Redis disconnected');
  }

  // Create vector index for native vector search
  private async createVectorIndex() {
    if (this.vectorIndexCreated) return;
    
    try {
      // Check if index already exists
      const indexes = await this.client.sendCommand(['FT._LIST']);
      if (Array.isArray(indexes) && indexes.includes('idx:properties')) {
        console.log('✅ Vector index already exists');
        this.vectorIndexCreated = true;
        return;
      }
      
      // Try to create vector index using raw Redis commands
      await this.client.sendCommand(['FT.CREATE', 'idx:properties', 'ON', 'JSON', 'PREFIX', '1', 'property:', 'SCHEMA', '$.property_name', 'TEXT', '$.address.raw', 'TEXT', '$.rental_terms.rent', 'NUMERIC', '$.unit_details.beds', 'NUMERIC', '$.unit_details.baths', 'NUMERIC', '$.pet_policy.pets_allowed.allowed', 'TAG', '$.embedding', 'VECTOR', 'FLAT', '6', 'TYPE', 'FLOAT32', 'DIM', '1536', 'DISTANCE_METRIC', 'COSINE']);
      
      console.log('✅ Created vector index for native search');
      this.vectorIndexCreated = true;
    } catch (error: any) {
      console.log('⚠️ Could not create vector index (falling back to manual search):', error?.message || error);
      this.vectorIndexCreated = false;
    }
  }

  // Fast connection test
  async testConnection(): Promise<boolean> {
    try {
      // If not connected, try to connect
      if (!this.isConnected) {
        await this.connect();
      }
      
      // Test if client is actually connected
      if (!this.client.isOpen) {
        console.log('🔌 Redis client not open, reconnecting...');
        await this.connect();
      }
      
      await this.client.set('test', 'ok');
      const result = await this.client.get('test');
      await this.client.del('test');
      return result === 'ok';
    } catch (error) {
      console.error('❌ Redis connection test failed:', error);
      // Try to reconnect on error
      try {
        await this.connect();
        return true;
      } catch (reconnectError) {
        console.error('❌ Redis reconnect failed:', reconnectError);
        return false;
      }
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

  // Simple fast search
  async searchProperties(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    
    try {
      console.log('🔍 Starting Redis search...');
      
      // Test connection first
      const isConnected = await this.testConnection();
      console.log(`🔌 Redis connected: ${isConnected}`);
      
      if (!isConnected) {
        console.error('❌ Redis not connected');
        return {
          properties: [],
          query,
          latency: Date.now() - startTime,
          cacheHit: false
        };
      }
      
      // Just get all properties for now
      const keys = await this.client.keys('property:*');
      console.log(`🔍 Found ${keys.length} property keys in Redis`);
      
      const properties: Property[] = [];
      
      for (const key of keys) {
        try {
          const data = await this.client.json.get(key);
          if (data) {
            const property = data as unknown as Property;
            properties.push(property);
            console.log(`✅ Loaded property: ${property.property_name}`);
          }
        } catch (error) {
          console.error(`❌ Error getting property ${key}:`, error);
        }
      }
      
      console.log(`🎯 Total properties loaded: ${properties.length}`);
      
      return {
        properties,
        query,
        latency: Date.now() - startTime,
        cacheHit: false
      };
    } catch (error) {
      console.error('Search error:', error);
      return {
        properties: [],
        query,
        latency: Date.now() - startTime,
        cacheHit: false
      };
    }
  }

  // Fast exact search - optimized for speed
  private async fastExactSearch(): Promise<Property[]> {
    // Use a simple pattern to get all properties quickly
    const keys = await this.client.keys('property:*');
    
    // Batch fetch all properties at once
    if (keys.length === 0) return [];
    
    const pipeline = this.client.multi();
    keys.forEach(key => pipeline.json.get(key));
    const results = await pipeline.exec();
    
    const properties: Property[] = [];
    if (results) {
      for (const result of results) {
        if (result && Array.isArray(result) && result[1]) {
          properties.push(result[1] as unknown as Property);
        }
      }
    }
    
    return properties;
  }

  // Exact search with filters (legacy)
  private async exactSearch(query: SearchQuery): Promise<Property[]> {
    const keys = await this.client.keys('property:*');
    const properties: Property[] = [];
    
    for (const key of keys) {
      const data = await this.client.json.get(key);
      if (data) {
        const property = data as unknown as Property;
        properties.push(property);
      }
    }
    
    return properties;
  }

  // Native vector search using Redis Stack
  private async nativeVectorSearch(query: string): Promise<Property[]> {
    if (!this.vectorIndexCreated) {
      console.log('⚠️ Vector index not available, using manual search');
      return [];
    }

    try {
      // Get query embedding
      const { OpenAIService } = await import('./openai');
      const openai = new OpenAIService();
      const queryEmbedding = await openai.getEmbedding(query);
      
      // Convert embedding to blob for Redis
      const embeddingBlob = Buffer.from(new Float32Array(queryEmbedding).buffer);
      
      // Native vector search using raw Redis commands
      const results = await this.client.sendCommand([
        'FT.SEARCH', 'idx:properties', 
        '*=>[KNN 5 @embedding $query_vec]', 
        'PARAMS', '2', 'query_vec', embeddingBlob.toString('base64'),
        'DIALECT', '2'
      ]);
      
      console.log(`🚀 Native vector search found results`);
      
      // Parse results manually
      const properties: Property[] = [];
      if (Array.isArray(results) && results.length > 1) {
        // Skip first element (total count)
        for (let i = 1; i < results.length; i += 2) {
          const key = results[i];
          const data = results[i + 1];
          if (typeof key === 'string' && Array.isArray(data) && data.length > 1) {
            try {
              // Find the JSON data in the results
              for (let j = 0; j < data.length; j += 2) {
                if (data[j] === '$') {
                  const propertyData = JSON.parse(data[j + 1] as string);
                  properties.push(propertyData as Property);
                  break;
                }
              }
            } catch (error) {
              console.error('Failed to parse property data:', error);
            }
          }
        }
      }
      
      console.log(`✅ Native vector search returned ${properties.length} properties`);
      return properties;
    } catch (error) {
      console.error('Native vector search error:', error);
      return [];
    }
  }

  // Manual semantic search (fallback)
  private async semanticSearch(query: string): Promise<Property[]> {
    try {
      // Get query embedding
      const { OpenAIService } = await import('./openai');
      const openai = new OpenAIService();
      const queryEmbedding = await openai.getEmbedding(query);
      
      // Get all embeddings
      const embeddingKeys = await this.client.keys('embedding:*');
      const similarities: { id: string; similarity: number }[] = [];
      
      for (const key of embeddingKeys) {
        const data = await this.client.json.get(key);
        if (data && (data as any).embedding) {
          const embedding = (data as any).embedding as number[];
          const similarity = this.cosineSimilarity(queryEmbedding, embedding);
          const id = key.replace('embedding:', '');
          similarities.push({ id, similarity });
        }
      }
      
      // Sort by similarity and get top results
      similarities.sort((a, b) => b.similarity - a.similarity);
      const topIds = similarities.slice(0, 5).map(s => s.id);
      
      // Get properties for top results
      const properties: Property[] = [];
      for (const id of topIds) {
        const property = await this.getProperty(id);
        if (property) {
          properties.push(property);
        }
      }
      
      return properties;
    } catch (error) {
      console.error('Semantic search error:', error);
      return [];
    }
  }

  // Calculate cosine similarity between two vectors
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Enhanced property storage with vector index
  async storePropertyWithEmbedding(property: Property) {
    try {
      // Generate embedding first
      const { OpenAIService } = await import('./openai');
      const openai = new OpenAIService();
      
      // Create text representation for embedding
      const propertyText = this.createPropertyText(property);
      const embedding = await openai.getEmbedding(propertyText);
      
      // Store property with embedding in vector index format
      const propertyWithEmbedding = {
        ...property,
        embedding: embedding
      };
      
      // Store in vector index format using listing ID as key
      await this.client.json.set(`property:${property.listing_urls.listing_id}`, '$', propertyWithEmbedding as any);
      
      // Also store embedding separately for manual search fallback
      await this.storeEmbedding(property.listing_urls.listing_id, embedding);
      
      console.log(`✅ Stored property ${property.property_name} with embedding`);
    } catch (error) {
      console.error('Failed to store property with embedding:', error);
      throw error;
    }
  }

  // Create text representation for embedding
  private createPropertyText(property: Property): string {
    return `
      ${property.property_name}
      ${property.address.raw}
      ${property.unit_details.beds} bedroom ${property.unit_details.baths} bathroom
      ${property.unit_details.square_feet} square feet
      $${property.rental_terms.rent} rent
      ${property.pet_policy.pets_allowed.allowed ? 'pets allowed' : 'no pets'}
      ${property.pet_policy.pet_rent ? `pet rent $${property.pet_policy.pet_rent}` : ''}
      ${property.appliances.join(' ')}
      ${property.utilities_included.join(' ')}
      ${property.special_offer.text || ''}
    `.replace(/\s+/g, ' ').trim();
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
    console.log(`Loading ${properties.length} properties with embeddings...`);
    
    for (const property of properties) {
      await this.storePropertyWithEmbedding(property);
    }
    
    console.log(`✅ Loaded ${properties.length} properties with embeddings`);
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