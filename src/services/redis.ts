import { createClient } from 'redis';
import { config } from '../config';
import { Property, SearchQuery, SearchResult, ChatSession } from '../types';
import { Logger } from '../utils/logger';
import crypto from 'crypto';

export class RedisService {
  private client;
  private vectorIndexCreated = false;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;
  private openaiService: any = null; // Cache OpenAI service instance
  
  // In-memory cache for instant responses
  private propertyCache: Property[] = [];
  private cacheTimestamp = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.client = createClient({
      url: config.redis.url,
      socket: {
        reconnectStrategy: (retries) => {
          Logger.debug(`Redis reconnection attempt ${retries}`);
          return Math.min(retries * 100, 3000);
        }
      }
    });

    // Handle connection events
    this.client.on('connect', () => {
      Logger.info('Redis connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      Logger.info('Redis ready');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      Logger.error(`Redis error: ${err}`);
      this.isConnected = false;
    });

    this.client.on('end', () => {
      Logger.info('Redis connection ended');
      this.isConnected = false;
    });

    this.client.on('reconnecting', () => {
      Logger.info('Redis reconnecting...');
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
      Logger.debug('Redis already connected');
      return;
    }
    
    try {
      await this.client.connect();
      this.isConnected = true;
      Logger.info('Redis connected successfully');
      
      // Try to create vector index on connection
      await this.createVectorIndex();
    } catch (error) {
      Logger.error(`Redis connection failed: ${error}`);
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
        Logger.info('Vector index already exists');
        this.vectorIndexCreated = true;
        return;
      }
      
      // Create a simpler index that actually works
      await this.client.sendCommand(['FT.CREATE', 'idx:properties', 'ON', 'JSON', 'PREFIX', '1', 'property:', 'SCHEMA', '$.property_name', 'TEXT', '$.address.raw', 'TEXT', '$.rental_terms.rent', 'NUMERIC', '$.unit_details.beds', 'NUMERIC', '$.unit_details.baths', 'NUMERIC', '$.pet_policy.pets_allowed.allowed', 'TAG', 'AS', 'pets_allowed_allowed']);
      
      Logger.info('Created vector index for native search');
      this.vectorIndexCreated = true;
    } catch (error: any) {
      Logger.warn(`Could not create vector index: ${error?.message || error}`);
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
      const sessionData = await this.client.json.get(`session:${id}`);
      return sessionData ? (sessionData as unknown as ChatSession) : null;
    } catch (error) {
      Logger.error(`Get session error: ${error}`);
      return null;
    }
  }

  // Additional session management for generic data
  async getSessionData(sessionId: string): Promise<any> {
    try {
      await this.ensureConnection();
      const sessionData = await this.client.get(`session:${sessionId}`);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch (error) {
      Logger.error(`Get session data error: ${error}`);
      return null;
    }
  }

  async setSessionData(sessionId: string, data: any): Promise<void> {
    try {
      await this.ensureConnection();
      await this.client.set(`session:${sessionId}`, JSON.stringify(data), { EX: 3600 }); // 1 hour TTL
    } catch (error) {
      Logger.error(`Set session data error: ${error}`);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await this.ensureConnection();
      await this.client.del(`session:${sessionId}`);
    } catch (error) {
      Logger.error(`Delete session error: ${error}`);
    }
  }

  // Health check method
  async ping(): Promise<boolean> {
    try {
      await this.ensureConnection();
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      Logger.error(`Redis ping error: ${error}`);
      return false;
    }
  }

  // Helper to normalize and hash queries for caching
  private getCacheKey(query: SearchQuery): string {
    const normalized = JSON.stringify({
      query: query.query.trim().toLowerCase(),
      filters: query.filters || {}
    });
    return 'langcache:' + crypto.createHash('sha256').update(normalized).digest('hex');
  }

  async searchProperties(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now();
    try {
      Logger.debug(`Starting Redis search (type: ${query.type})...`);
      await this.ensureConnection();

      const cacheKey = this.getCacheKey(query);
      const cached = await this.client.get(cacheKey);
      if (cached) {
        Logger.info(`LangCache hit for key: ${cacheKey}`);
        return {
          properties: JSON.parse(cached),
          query,
          latency: Date.now() - startTime,
          cacheHit: true
        };
      } else {
        Logger.info(`LangCache miss for key: ${cacheKey}`);
      }

      let properties: Property[] = [];
      let searchMode = '';
      if (query.filters && Object.keys(query.filters).length > 0) {
        properties = await this.exactSearch(query);
        searchMode = 'exact';
      } else {
        properties = await this.hybridSearch(query);
        searchMode = 'hybrid';
      }
      Logger.info(`Redis search used mode: ${searchMode}, found ${properties.length} properties in ${Date.now() - startTime}ms`);

      // Cache results for 5 minutes
      await this.client.set(cacheKey, JSON.stringify(properties), { EX: 300 });

      return {
        properties,
        query,
        latency: Date.now() - startTime,
        cacheHit: false
      };
    } catch (error) {
      Logger.error(`Redis search error: ${error}`);
      return {
        properties: [],
        query,
        latency: Date.now() - startTime,
        cacheHit: false
      };
    }
  }



  // Hybrid search strategy
  private async hybridSearch(query: SearchQuery): Promise<Property[]> {
    console.log('🔄 Using optimized hybrid search...');
    
    try {
      // Try exact search first (more reliable)
      const exactResults = await this.exactSearch(query);
      
      if (exactResults.length >= 3) {
        return exactResults;
      }
      
      // If exact search didn't find enough, try semantic search
      console.log('📝 Supplementing with semantic search for more results...');
      const semanticResults = await this.semanticSearch(query.query);
      
      // Merge and deduplicate results
      const existingIds = new Set(exactResults.map(p => p.listing_urls.listing_id));
      const additionalResults = semanticResults.filter(p => !existingIds.has(p.listing_urls.listing_id));
      
      return [...exactResults, ...additionalResults.slice(0, 5 - exactResults.length)];
    } catch (error) {
      console.log('⚠️ Hybrid search failed, using exact search...');
      return await this.exactSearch(query);
    }
  }

  // Fast exact search using FT.SEARCH for better performance
  private async fastExactSearch(query: SearchQuery): Promise<Property[]> {
    await this.ensureConnection();
    
    // If no filters, use fallback method directly (more reliable)
    if (!query.filters || Object.keys(query.filters).length === 0) {
      console.log('🔄 No filters provided, using fallback search for all properties');
      return this.fallbackExactSearch();
    }
    
    let searchQueryStr = '*';
    const conditions = [];
    if (query.filters.beds) conditions.push(`@beds:${query.filters.beds}`);
    if (query.filters.baths) conditions.push(`@baths:${query.filters.baths}`);
    if (query.filters.rent?.min) conditions.push(`@rent:[${query.filters.rent.min} inf]`);
    if (query.filters.rent?.max) conditions.push(`@rent:[-inf ${query.filters.rent.max}]`);
    if (query.filters.city) conditions.push(`@city:{${query.filters.city}}`);
    if (query.filters.pets_allowed !== undefined) {
      const petsValue = query.filters.pets_allowed ? 'true' : 'false';
      conditions.push(`@pets_allowed_allowed:{${petsValue}}`);
    }
    
    if (conditions.length > 0) {
      searchQueryStr = conditions.join(' ');
    }
    
    try {
      console.log(`🔍 FT.SEARCH query: "${searchQueryStr}"`);
      const results = await this.client.sendCommand([
        'FT.SEARCH', 'idx:properties', searchQueryStr,
        'LIMIT', '0', '10' // Limit to top 10
      ]);
      
      const properties: Property[] = [];
      if (Array.isArray(results)) {
        for (let i = 1; i < results.length; i += 2) {
          const key = results[i] as string;
          const property = await this.getProperty(key.replace('property:', ''));
          if (property) properties.push(property);
        }
      }
      
      console.log(`🎯 Loaded ${properties.length} properties via FT.SEARCH`);
      return properties;
    } catch (error) {
      console.error(`❌ FT.SEARCH failed with query "${searchQueryStr}":`, error);
      // Fallback to the old method if FT.SEARCH fails
      return this.fallbackExactSearch();
    }
  }

  // Fallback method using keys (for when FT.SEARCH is not available)
  private async fallbackExactSearch(): Promise<Property[]> {
    // Check in-memory cache first
    if (this.propertyCache.length > 0 && (Date.now() - this.cacheTimestamp) < this.CACHE_TTL) {
      Logger.debug(`Using cached properties (${this.propertyCache.length} items)`);
      return this.propertyCache;
    }
    
    await this.ensureConnection();
    
    const keys = await this.client.keys('property:*');
    Logger.debug(`Found ${keys.length} property keys in Redis`);
    
    if (keys.length === 0) {
      Logger.warn('No property keys found in Redis');
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
          Logger.error(`Error getting property ${key}: ${error}`);
        }
        return null;
      });
      
      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      const validProperties = batchResults.filter(p => p !== null) as Property[];
      properties.push(...validProperties);
    }
    
    // Cache the results
    this.propertyCache = properties;
    this.cacheTimestamp = Date.now();
    
    Logger.debug(`Loaded ${properties.length} properties into cache`);
    return properties;
  }

  // Exact search with filters (optimized)
  private async exactSearch(query: SearchQuery): Promise<Property[]> {
    await this.ensureConnection();
    
    // Use FT.SEARCH for efficient filtering
    const properties = await this.fastExactSearch(query);
    
    // If FT.SEARCH didn't apply filters (fallback), apply them manually
    if (query.filters && properties.length > 0) {
      const filteredProperties = properties.filter(property => this.matchesFilters(property, query.filters));
      return filteredProperties.slice(0, 10);
    }
    
    return properties.slice(0, 10);
  }

  // Native vector search using Redis Stack
  private async nativeVectorSearch(query: string): Promise<Property[]> {
    await this.ensureConnection();
    
    try {
      // Get query embedding
      const embedding = await this.getQueryEmbedding(query);
      if (!embedding) {
        console.log('⚠️ Could not get query embedding, falling back to exact search');
        return this.fallbackExactSearch();
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
      const properties = await this.fallbackExactSearch();
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

  // Get or create OpenAI service instance
  private async getOpenAIService() {
    if (!this.openaiService) {
      const { OpenAIService } = await import('./openai');
      this.openaiService = new OpenAIService();
    }
    return this.openaiService;
  }

  // Get embedding for query text
  private async getQueryEmbedding(query: string): Promise<number[] | null> {
    try {
      const openai = await this.getOpenAIService();
      return await openai.getEmbedding(query);
    } catch (error) {
      console.error('❌ Failed to get query embedding:', error);
      return null;
    }
  }

  // Get embedding for property text
  private async getTextEmbedding(text: string): Promise<number[] | null> {
    try {
      const openai = await this.getOpenAIService();
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

  // Simplified property filtering
  private matchesFilters(property: Property, filters: SearchQuery['filters']): boolean {
    if (!filters) return true;
    
    const filterChecks = [
      // Bed count
      () => !filters.beds || property.unit_details.beds === filters.beds,
      // Bath count
      () => !filters.baths || property.unit_details.baths === filters.baths,
      // Rent range
      () => {
        if (!filters.rent) return true;
        const rent = property.rental_terms.rent;
        return (!filters.rent.min || rent >= filters.rent.min) && 
               (!filters.rent.max || rent <= filters.rent.max);
      },
      // City
      () => !filters.city || property.address.city.toLowerCase().includes(filters.city.toLowerCase()),
      // Pet policy
      () => filters.pets_allowed === undefined || property.pet_policy.pets_allowed.allowed === filters.pets_allowed,
      // Square footage
      () => {
        if (!filters.square_feet) return true;
        const sqft = property.unit_details.square_feet;
        return (!filters.square_feet.min || sqft >= filters.square_feet.min) && 
               (!filters.square_feet.max || sqft <= filters.square_feet.max);
      }
    ];
    
    return filterChecks.every(check => check());
  }

  // Load sample data with batch embeddings for better performance
  async loadSampleData(properties: Property[]): Promise<void> {
    await this.ensureConnection();
    
    console.log(`📦 Loading ${properties.length} properties into Redis...`);
    
    // Store all properties first
    for (const property of properties) {
      try {
        await this.storeProperty(property);
      } catch (error) {
        console.error(`❌ Failed to store property ${property.property_name}:`, error);
      }
    }
    
    // Generate all property texts for batch embedding
    const propertyTexts = properties.map(property => this.createPropertyText(property));
    
    try {
      // Get batch embeddings
      const openai = await this.getOpenAIService();
      const embeddings = await openai.getEmbeddings(propertyTexts);
      
      // Store embeddings in parallel
      const embeddingPromises = properties.map(async (property, index) => {
        const embedding = embeddings[index];
        if (embedding) {
          await this.storeEmbedding(property.listing_urls.listing_id, embedding);
          console.log(`✅ Stored embedding for: ${property.property_name}`);
        } else {
          console.log(`⚠️ Could not create embedding for: ${property.property_name}`);
        }
      });
      
      await Promise.all(embeddingPromises);
      console.log('✅ Sample data loaded successfully with batch embeddings');
    } catch (error) {
      console.error('❌ Failed to load embeddings in batch:', error);
      console.log('🔄 Falling back to individual embeddings...');
      
      // Fallback to individual embeddings
      for (const property of properties) {
        try {
          const text = this.createPropertyText(property);
          const embedding = await this.getTextEmbedding(text);
          if (embedding) {
            await this.storeEmbedding(property.listing_urls.listing_id, embedding);
          }
        } catch (error) {
          console.error(`❌ Failed to create embedding for ${property.property_name}:`, error);
        }
      }
    }
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
