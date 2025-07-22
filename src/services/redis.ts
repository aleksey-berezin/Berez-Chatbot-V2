import { createClient } from 'redis';
import { config } from '../config';
import { Property, SearchQuery, SearchResult, ChatSession } from '../types';

export class RedisService {
  private client;
  private vectorIndexCreated = false;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor() {
    this.client = createClient({
      url: config.redis.url,
      socket: {
        reconnectStrategy: (retries) => {
          console.log(`🔄 Redis reconnection attempt ${retries}`);
          return Math.min(retries * 100, 3000);
        }
      }
    });

    // Handle connection events
    this.client.on('connect', () => {
      console.log('🔌 Redis connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      console.log('✅ Redis ready');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('❌ Redis error:', err);
      this.isConnected = false;
    });

    this.client.on('end', () => {
      console.log('🔌 Redis connection ended');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
      this.isConnected = false;
    });
  }

  async connect() {
    // Prevent multiple simultaneous connection attempts
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._connect();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async _connect() {
    if (this.isConnected && this.client.isOpen) {
      console.log('🔌 Redis already connected');
      return;
    }
    
    try {
      await this.client.connect();
      this.isConnected = true;
      console.log('🔌 Redis connected successfully');
      
      // Try to create vector index on connection
      await this.createVectorIndex();
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) {
      return;
    }
    
    try {
      await this.client.disconnect();
      this.isConnected = false;
      console.log('🔌 Redis disconnected');
    } catch (error) {
      console.error('❌ Redis disconnect error:', error);
    }
  }

  // Ensure connection before any operation
  private async ensureConnection() {
    if (!this.isConnected || !this.client.isOpen) {
      console.log('🔌 Ensuring Redis connection...');
      await this.connect();
    }
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

  // Fast connection test with automatic reconnection
  async testConnection(): Promise<boolean> {
    try {
      await this.ensureConnection();
      
      await this.client.set('test', 'ok');
      const result = await this.client.get('test');
      await this.client.del('test');
      return result === 'ok';
    } catch (error) {
      console.error('❌ Redis connection test failed:', error);
      return false;
    }
  }

  // JSON storage for exact queries
  async storeProperty(property: Property) {
    await this.ensureConnection();
    await this.client.json.set(`property:${property.listing_urls.listing_id}`, '$', property as any);
  }

  async getProperty(id: string): Promise<Property | null> {
    await this.ensureConnection();
    const data = await this.client.json.get(`property:${id}`);
    return data ? (data as unknown as Property) : null;
  }

  // Vector storage for semantic search
  async storeEmbedding(id: string, embedding: number[]) {
    await this.ensureConnection();
    await this.client.json.set(`embedding:${id}`, '$', { embedding });
  }

  async getEmbedding(id: string): Promise<number[] | null> {
    await this.ensureConnection();
    const data = await this.client.json.get(`embedding:${id}`);
    return data ? (data as any).embedding : null;
  }

  // Session storage
  async storeSession(session: ChatSession) {
    await this.ensureConnection();
    await this.client.json.set(`session:${session.id}`, '$', session as any);
  }

  async getSession(id: string): Promise<ChatSession | null> {
    try {
      await this.ensureConnection();
      const data = await this.client.json.get(`session:${id}`);
      return data ? (data as unknown as ChatSession) : null;
    } catch (error) {
      console.error('Session error:', error);
      return null;
    }
  }

  // Optimized search based on query type
  async searchProperties(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    
    try {
      console.log(`🔍 Starting optimized Redis search (type: ${query.type})...`);
      
      // Ensure connection before search
      await this.ensureConnection();
      console.log('🔌 Redis connected: true');
      
      let properties: Property[] = [];
      
      // Optimized routing based on query type
      switch (query.type) {
        case 'semantic':
          console.log('🧠 Using native vector search for semantic query...');
          properties = await this.nativeVectorSearch(query.query);
          break;
          
        case 'exact':
          console.log('🎯 Using optimized exact search...');
          properties = await this.exactSearch(query);
          break;
          
        case 'hybrid':
          console.log('🔄 Using optimized hybrid search...');
          // Try native vector search first for speed
          try {
            properties = await this.nativeVectorSearch(query.query);
            // If vector search returns few results, supplement with exact search
            if (properties.length < 3) {
              console.log('📝 Supplementing with exact search for more results...');
              const exactResults = await this.exactSearch(query);
              // Merge and deduplicate results
              const existingIds = new Set(properties.map(p => p.listing_urls.listing_id));
              const additionalResults = exactResults.filter(p => !existingIds.has(p.listing_urls.listing_id));
              properties = [...properties, ...additionalResults.slice(0, 5 - properties.length)];
            }
          } catch (error) {
            console.log('⚠️ Vector search failed, using exact search...');
            properties = await this.exactSearch(query);
          }
          break;
          
        default:
          console.log('📝 Using default exact search...');
          properties = await this.exactSearch(query);
      }
      
      console.log(`🎯 Found ${properties.length} properties with ${query.type} search in ${Date.now() - startTime}ms`);
      
      return {
        properties,
        query,
        latency: Date.now() - startTime,
        cacheHit: false
      };
      
    } catch (error) {
      console.error('❌ Redis search failed:', error);
      return {
        properties: [],
        query,
        latency: Date.now() - startTime,
        cacheHit: false
      };
    }
  }

  // Fast exact search - optimized for speed with batch operations
  private async fastExactSearch(): Promise<Property[]> {
    await this.ensureConnection();
    
    const keys = await this.client.keys('property:*');
    console.log(`🔍 Found ${keys.length} property keys in Redis`);
    
    if (keys.length === 0) {
      console.log('📭 No property keys found in Redis');
      return [];
    }
    
    // Use batch operations for better performance
    const properties: Property[] = [];
    const batchSize = 10; // Process in batches of 10
    
    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      
      // Create batch of promises
      const batchPromises = batch.map(async (key) => {
        try {
          const data = await this.client.json.get(key);
          if (data) {
            return data as unknown as Property;
          }
        } catch (error) {
          console.error(`❌ Error getting property ${key}:`, error);
        }
        return null;
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      const validProperties = batchResults.filter(p => p !== null) as Property[];
      properties.push(...validProperties);
    }
    
    console.log(`🎯 Total properties loaded: ${properties.length} in ${keys.length} batches`);
    return properties;
  }

  // Exact search with filters (optimized)
  private async exactSearch(query: SearchQuery): Promise<Property[]> {
    await this.ensureConnection();
    
    // Get all properties efficiently using batch operations
    const properties = await this.fastExactSearch();
    
    if (!query.filters) {
      // Return top 10 properties if no filters
      return properties.slice(0, 10);
    }
    
    // Apply filters and return top 10 results
    const filteredProperties = properties.filter(property => this.matchesFilters(property, query.filters));
    return filteredProperties.slice(0, 10);
  }

  // Native vector search using Redis Stack
  private async nativeVectorSearch(query: string): Promise<Property[]> {
    await this.ensureConnection();
    
    try {
      // Get query embedding
      const embedding = await this.getQueryEmbedding(query);
      if (!embedding) {
        console.log('⚠️ Could not get query embedding, falling back to exact search');
        return this.fastExactSearch();
      }
      
      // Convert embedding to binary format for Redis
      const binaryEmbedding = Buffer.from(new Float32Array(embedding).buffer);
      
      // Use native vector search
      const results = await this.client.sendCommand([
        'FT.SEARCH', 'idx:properties', 
        `*=>[KNN 10 @embedding $BLOB]`,
        'PARAMS', '2', 'BLOB', binaryEmbedding.toString('base64'),
        'SORTBY', '__vector_score', 'DIALECT', '2'
      ]);
      
      if (!Array.isArray(results) || results.length === 0) {
        return [];
      }
      
      // Parse results (first element is count, rest are key-value pairs)
      const properties: Property[] = [];
      for (let i = 1; i < results.length; i += 2) {
        const key = results[i] as string;
        const property = await this.getProperty(key.replace('property:', ''));
        if (property) {
          properties.push(property);
        }
      }
      
      return properties;
    } catch (error) {
      console.log('⚠️ Native vector search failed, falling back to manual search:', error);
      return this.semanticSearch(query);
    }
  }

  // Manual semantic search with embeddings (optimized)
  private async semanticSearch(query: string): Promise<Property[]> {
    await this.ensureConnection();
    
    try {
      // Get query embedding
      const queryEmbedding = await this.getQueryEmbedding(query);
      if (!queryEmbedding) {
        console.log('⚠️ Could not get query embedding');
        return [];
      }
      
      // Get all properties with embeddings
      const properties = await this.fastExactSearch();
      const propertiesWithEmbeddings: Array<{ property: Property; embedding: number[] }> = [];
      
      for (const property of properties) {
        const embedding = await this.getEmbedding(property.listing_urls.listing_id);
        if (embedding) {
          propertiesWithEmbeddings.push({ property, embedding });
        }
      }
      
      if (propertiesWithEmbeddings.length === 0) {
        return properties.slice(0, 5); // Fallback to top 5 properties
      }
      
      // Calculate similarities
      const similarities = propertiesWithEmbeddings.map(({ property, embedding }) => ({
        property,
        similarity: this.cosineSimilarity(queryEmbedding, embedding)
      }));
      
      // Sort by similarity and return top 5 results
      similarities.sort((a, b) => b.similarity - a.similarity);
      
      return similarities.slice(0, 5).map(item => item.property);
    } catch (error) {
      console.error('❌ Semantic search failed:', error);
      return [];
    }
  }

  // Calculate cosine similarity between two vectors
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  // Store property with embedding
  async storePropertyWithEmbedding(property: Property) {
    await this.ensureConnection();
    
    try {
      // Store property data
      await this.storeProperty(property);
      
      // Create and store embedding
      const text = this.createPropertyText(property);
      const embedding = await this.getTextEmbedding(text);
      
      if (embedding) {
        await this.storeEmbedding(property.listing_urls.listing_id, embedding);
        console.log(`✅ Stored property with embedding: ${property.property_name}`);
      } else {
        console.log(`⚠️ Could not create embedding for: ${property.property_name}`);
      }
    } catch (error) {
      console.error('❌ Failed to store property with embedding:', error);
      throw error;
    }
  }

  // Get embedding for query text
  private async getQueryEmbedding(query: string): Promise<number[] | null> {
    try {
      const { OpenAIService } = await import('./openai');
      const openai = new OpenAIService();
      return await openai.getEmbedding(query);
    } catch (error) {
      console.error('❌ Failed to get query embedding:', error);
      return null;
    }
  }

  // Get embedding for property text
  private async getTextEmbedding(text: string): Promise<number[] | null> {
    try {
      const { OpenAIService } = await import('./openai');
      const openai = new OpenAIService();
      return await openai.getEmbedding(text);
    } catch (error) {
      console.error('❌ Failed to get text embedding:', error);
      return null;
    }
  }

  // Create text representation of property for embedding
  private createPropertyText(property: Property): string {
    return `${property.property_name} ${property.address.raw} ${property.unit_details.beds} bedroom ${property.unit_details.baths} bathroom ${property.rental_terms.rent} rent ${property.pet_policy.pets_allowed.allowed ? 'pet friendly' : 'no pets'} ${property.unit_details.square_feet} square feet`;
  }

  // Check if property matches filters
  private matchesFilters(property: Property, filters: SearchQuery['filters']): boolean {
    if (!filters) return true;
    
    // Bed count filter
    if (filters.beds && property.unit_details.beds !== filters.beds) {
      return false;
    }
    
    // Bath count filter
    if (filters.baths && property.unit_details.baths !== filters.baths) {
      return false;
    }
    
    // Rent range filter
    if (filters.rent) {
      const rent = property.rental_terms.rent;
      if (filters.rent.min && rent < filters.rent.min) return false;
      if (filters.rent.max && rent > filters.rent.max) return false;
    }
    
    // City filter
    if (filters.city && !property.address.city.toLowerCase().includes(filters.city.toLowerCase())) {
      return false;
    }
    
    // Pet policy filter
    if (filters.pets_allowed !== undefined && property.pet_policy.pets_allowed.allowed !== filters.pets_allowed) {
      return false;
    }
    
    // Square footage filter
    if (filters.square_feet) {
      const sqft = property.unit_details.square_feet;
      if (filters.square_feet.min && sqft < filters.square_feet.min) return false;
      if (filters.square_feet.max && sqft > filters.square_feet.max) return false;
    }
    
    return true;
  }

  // Load sample data
  async loadSampleData(properties: Property[]): Promise<void> {
    await this.ensureConnection();
    
    console.log(`📦 Loading ${properties.length} properties into Redis...`);
    
    for (const property of properties) {
      try {
        await this.storePropertyWithEmbedding(property);
      } catch (error) {
        console.error(`❌ Failed to load property ${property.property_name}:`, error);
      }
    }
    
    console.log('✅ Sample data loaded successfully');
  }

  // Get all property keys
  async getAllPropertyKeys(): Promise<string[]> {
    await this.ensureConnection();
    return await this.client.keys('property:*');
  }

  // Remove sample data
  async removeSampleData(): Promise<number> {
    await this.ensureConnection();
    
    const keys = await this.client.keys('property:*');
    if (keys.length === 0) {
      console.log('📭 No properties to remove');
      return 0;
    }
    
    console.log(`🗑️ Removing ${keys.length} properties...`);
    
    const pipeline = this.client.multi();
    keys.forEach(key => pipeline.del(key));
    
    // Also remove embeddings
    const embeddingKeys = await this.client.keys('embedding:*');
    embeddingKeys.forEach(key => pipeline.del(key));
    
    await pipeline.exec();
    
    console.log(`✅ Removed ${keys.length} properties and ${embeddingKeys.length} embeddings`);
    return keys.length;
  }

  // Remove null entries
  async removeNullEntries(): Promise<number> {
    await this.ensureConnection();
    
    const keys = await this.client.keys('property:*');
    let removedCount = 0;
    
    for (const key of keys) {
      try {
        const data = await this.client.json.get(key);
        if (!data || data === null) {
          await this.client.del(key);
          removedCount++;
        }
      } catch (error) {
        console.error(`❌ Error checking key ${key}:`, error);
      }
    }
    
    console.log(`✅ Removed ${removedCount} null entries`);
    return removedCount;
  }
} 
