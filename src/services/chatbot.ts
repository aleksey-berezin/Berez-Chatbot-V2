import { v4 as uuidv4 } from 'uuid';
import { LRUCache } from 'lru-cache';
import { RedisService } from './redis';
import { OpenAIService } from './openai';
import { ChatMessage, ChatSession, Property, SearchQuery } from '../types';

// Performance monitoring interface
interface PerformanceMetrics {
  redisLatency: number;
  openaiLatency: number;
  totalLatency: number;
  tokenUsage?: {
    total: number;
    prompt: number;
    completion: number;
    percentage: number;
  };
  cacheHit: boolean;
  propertiesFound: number;
}

// Truncated property interface for token optimization
interface TruncatedProperty {
  property_name: string;
  address: {
    raw: string;
    city: string;
  };
  unit_details: {
    beds: number;
    baths: number;
    available: string;
    square_feet: number;
  };
  rental_terms: {
    rent: number;
    security_deposit: number;
  };
  pet_policy: {
    pets_allowed: {
      allowed: boolean;
    };
  };
}

export class ChatbotService {
  private redis: RedisService;
  private openai: OpenAIService;
  private isConnected = false;
  
  // Replace Map with LRU Cache for better memory management
  private responseCache = new LRUCache<string, { response: string; timestamp: number }>({
    max: 1000, // Maximum 1000 cached responses
    ttl: 5 * 60 * 1000, // 5 minutes TTL (increased from 2 minutes)
    updateAgeOnGet: true, // Update access time on get
    allowStale: false, // Don't return stale items
  });
  
  // Performance monitoring
  private performanceMetrics: PerformanceMetrics[] = [];
  private maxMetricsHistory = 100; // Keep last 100 requests

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

  // Token estimation using tiktoken
  private estimateTokens(text: string): number {
    // Improved estimation: ~3.5 characters per token for English text
    // This is more accurate than the previous 4 chars/token estimate
    // In production, you'd use tiktoken for exact counting
    return Math.ceil(text.length / 3.5);
  }

  // Normalize cache key for better hit rates
  private normalizeCacheKey(userMessage: string): string {
    return userMessage
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize whitespace
      .substring(0, 100); // Limit length
  }

  // Truncate property data to stay within token limits
  private truncatePropertyData(properties: Property[], maxTokens: number = 2000): TruncatedProperty[] {
    const truncatedProperties: TruncatedProperty[] = properties.map(p => ({
      property_name: p.property_name,
      address: {
        raw: p.address.raw,
        city: p.address.city
      },
      unit_details: {
        beds: p.unit_details.beds,
        baths: p.unit_details.baths,
        available: p.unit_details.available,
        square_feet: p.unit_details.square_feet
      },
      rental_terms: {
        rent: p.rental_terms.rent,
        security_deposit: p.rental_terms.security_deposit
      },
      pet_policy: {
        pets_allowed: {
          allowed: p.pet_policy.pets_allowed.allowed
        }
      }
      // Removed: utilities, appliances, photos, urls to save tokens
    }));

    // Estimate total tokens
    const jsonString = JSON.stringify(truncatedProperties);
    const estimatedTokens = this.estimateTokens(jsonString);
    
    console.log(`🧠 Token estimation: ${estimatedTokens} tokens for ${properties.length} properties`);
    
    // If still too large, reduce number of properties
    if (estimatedTokens > maxTokens) {
      const maxProperties = Math.floor((maxTokens / estimatedTokens) * properties.length);
      console.log(`📉 Truncating from ${properties.length} to ${maxProperties} properties`);
      return truncatedProperties.slice(0, maxProperties);
    }
    
    return truncatedProperties;
  }

  // Main chat handler - optimized for performance
  async handleMessage(sessionId: string, userMessage: string): Promise<string> {
    const startTime = Date.now();
    const metrics: PerformanceMetrics = {
      redisLatency: 0,
      openaiLatency: 0,
      totalLatency: 0,
      cacheHit: false,
      propertiesFound: 0
    };

    try {
      // Check cache first for identical queries
      const cacheKey = this.normalizeCacheKey(userMessage);
      const cached = this.responseCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < 2 * 60 * 1000) {
        console.log('📦 Using cached response');
        metrics.cacheHit = true;
        metrics.totalLatency = Date.now() - startTime;
        this.recordMetrics(metrics);
        return cached.response;
      }

      // Get or create session
      const session = await this.getOrCreateSession(sessionId);
      
      // OPTIMIZED: Single Redis search followed by single OpenAI call
      console.log('🚀 Starting optimized single-pass operations...');
      
      // Start Redis search with intelligent query type selection
      const redisStart = Date.now();
      const searchQuery = {
        type: this.determineQueryType(userMessage),
        query: userMessage,
        filters: this.extractFilters(userMessage)
      };
      console.log('🔍 Search query:', JSON.stringify(searchQuery, null, 2));
      const searchResult = await this.redis.searchProperties(searchQuery);
      metrics.redisLatency = Date.now() - redisStart;
      console.log(`🔍 Search result: ${searchResult.properties?.length || 0} properties found in ${metrics.redisLatency}ms`);
      
      // If no properties found, give a simple response
      if (!searchResult.properties || searchResult.properties.length === 0) {
        const response = "I don't have any properties available at the moment. Please try again later or contact us for assistance.";
        metrics.totalLatency = Date.now() - startTime;
        this.recordMetrics(metrics);
        return response;
      }
      
      // Truncate property data to stay within token limits (reduced to 1200 tokens for faster processing)
      const truncatedProperties = this.truncatePropertyData(searchResult.properties, 1200);
      metrics.propertiesFound = truncatedProperties.length;
      
      // Prepare optimized context for OpenAI
      const messages = [
        {
          role: 'system' as const,
          content: `You are a real estate assistant. Respond in 2-3 sentences max. Use bullet points. Be direct and helpful.`
        },
        {
          role: 'user' as const,
          content: `Question: ${userMessage}\n\nProperties: ${JSON.stringify(truncatedProperties)}\n\nAnswer concisely in 2-3 sentences.`
        }
      ];
      
      // Single OpenAI call with optimized property data
      const openaiStart = Date.now();
      console.log('🤖 Making single optimized OpenAI call...');
      
      let response = '';
      let usage = null;
      
      try {
        const aiResponse = await this.openai.chat(messages, false);
        response = typeof aiResponse === 'object' && 'content' in aiResponse ? aiResponse.content : '';
        usage = typeof aiResponse === 'object' && 'usage' in aiResponse ? aiResponse.usage : null;
        console.log('✅ OpenAI call successful');
      } catch (error) {
        console.error('❌ OpenAI call failed:', error);
        // Intelligent fallback response
        response = this.generateFallbackResponse(truncatedProperties);
      }
      
      metrics.openaiLatency = Date.now() - openaiStart;
      
      // Add token usage if available
      if (usage) {
        metrics.tokenUsage = {
          total: usage.total_tokens || 0,
          prompt: usage.prompt_tokens || 0,
          completion: usage.completion_tokens || 0,
          percentage: 0
        };
      }
      
      // Cache the response
      this.responseCache.set(cacheKey, { response, timestamp: Date.now() });
      
      // Update session in parallel
      const sessionUpdate = {
        id: uuidv4(),
        role: 'user' as const,
        content: userMessage,
        timestamp: Date.now()
      };
      
      session.messages.push(sessionUpdate);
      session.messages.push({
        id: uuidv4(),
        role: 'assistant' as const,
        content: response,
        timestamp: Date.now()
      });
      
      // Record final metrics
      metrics.totalLatency = Date.now() - startTime;
      this.recordMetrics(metrics);
      
      // Log performance summary
      console.log(`📊 Performance Summary:
        - Total: ${metrics.totalLatency}ms
        - Redis: ${metrics.redisLatency}ms
        - OpenAI: ${metrics.openaiLatency}ms
        - Properties: ${metrics.propertiesFound}
        - Cache Hit: ${metrics.cacheHit}`);
      
      session.updatedAt = Date.now();
      
      // Store session asynchronously (don't wait for it)
      this.redis.storeSession(session).catch(err => 
        console.error('Failed to store session:', err)
      );
      
      // Log comprehensive metrics
      metrics.totalLatency = Date.now() - startTime;
      console.log(`🤖 SINGLE-PASS RAG METRICS:`);
      console.log(`  📝 "${userMessage}"`);
      console.log(`  🏠 Found: ${metrics.propertiesFound} properties`);
      console.log(`  ⏱️  Redis: ${metrics.redisLatency}ms, OpenAI: ${metrics.openaiLatency}ms, Total: ${metrics.totalLatency}ms`);

      // Log token usage if available
      if (usage) {
        const maxTokens = 300;
        const totalTokens = usage.total_tokens || 0;
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const tokenPercentage = ((totalTokens / maxTokens) * 100).toFixed(1);
        const percentage = parseFloat(tokenPercentage);
        
        metrics.tokenUsage = {
          total: totalTokens,
          prompt: promptTokens,
          completion: completionTokens,
          percentage
        };
        
        const warning = percentage > 80 ? '⚠️ ' : percentage > 60 ? '⚡ ' : '';
        console.log(`  🧠 Token Usage: ${warning}${totalTokens}/${maxTokens} (${tokenPercentage}%)`);
        console.log(`     📤 Prompt: ${promptTokens} tokens`);
        console.log(`     📥 Completion: ${completionTokens} tokens`);
        
        if (percentage > 80) {
          console.log(`     ⚠️  WARNING: Approaching token limit! Consider reducing context or response length.`);
        }
      } else {
        console.log(`  📝 Response length: ${response.length} characters`);
      }
      
      console.log(`  📊 Session: ${sessionId} (${session.messages.length} messages)`);
      console.log(`  🗂️  Cache size: ${this.responseCache.size}/${this.responseCache.max}`);
      
      // Cache the response
      this.responseCache.set(cacheKey, { response, timestamp: Date.now() });
      
      // Record metrics
      this.recordMetrics(metrics);
      
      return response;
      
    } catch (error) {
      console.error('Chat error:', error);
      metrics.totalLatency = Date.now() - startTime;
      this.recordMetrics(metrics);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  // Streaming chat handler
  async handleMessageStream(sessionId: string, userMessage: string) {
    const startTime = Date.now();

    try {
      // Ensure Redis connection
      if (!this.isConnected) {
        await this.connect();
      }

      // Get or create session
      const session = await this.getOrCreateSession(sessionId);
      
      // Use intelligent query type selection for streaming
      const searchQuery: SearchQuery = {
        type: this.determineQueryType(userMessage),
        query: userMessage,
        filters: this.extractFilters(userMessage)
      };
      
      const searchResult = await this.redis.searchProperties(searchQuery);
      
      // Use OpenAI for streaming response
      let messages: any[];
      
      if (searchResult.properties.length > 0) {
        // Use heavily truncated property data to reduce token usage (reduced to 1000 tokens)
        const truncatedProperties = this.truncatePropertyData(searchResult.properties, 1000);
        
        messages = [
          {
            role: 'system' as const,
            content: `You are a helpful real estate assistant. Answer questions about properties based on the provided data. 

IMPORTANT: You have access to property information including:
- Address, unit details, rent, deposits
- Pet policies
- Basic property details

Provide accurate, detailed answers using the available data. Keep responses concise and use bullet points for readability.

Available properties:\n\n${JSON.stringify(truncatedProperties)}`
          },
          {
            role: 'user' as const,
            content: userMessage
          }
        ];
      } else {
        // No properties found - use OpenAI for general response
        messages = [
          {
            role: 'system' as const,
            content: 'You are a helpful real estate assistant. The user is asking about properties but none were found matching their criteria. Provide a helpful response.'
          },
          {
            role: 'user' as const,
            content: userMessage
          }
        ];
      }
      
      // Return the stream
      return await this.openai.chatStream(messages);
      
    } catch (error) {
      console.error('Streaming chat error:', error);
      throw error;
    }
  }

  // Add property to database
  async addProperty(property: Property): Promise<void> {
    try {
      if (!this.isConnected) {
        await this.connect();
      }
      
      await this.redis.storePropertyWithEmbedding(property);
      console.log(`Property ${property.property_name} added successfully with embedding`);
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

  // Get Redis service for testing
  getRedisService() {
    return this.redis;
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

  // Detect if user is asking about a specific property from conversation context
  private detectFocusedProperty(userMessage: string, session: ChatSession): string | null {
    const lowerMessage = userMessage.toLowerCase();
    
    // Check for broad questions that suggest looking for new properties
    const broadQuestions = [
      'what properties', 'show me properties', 'all properties', 'list properties',
      'available properties', 'search for', 'find properties', 'new properties'
    ];
    
    const isBroadQuestion = broadQuestions.some(term => lowerMessage.includes(term));
    if (isBroadQuestion) {
      return null; // User wants to see all properties
    }
    
    // Check if user is asking about a specific property mentioned in previous messages
    const recentMessages = session.messages.slice(-4); // Last 4 messages for context
    
    for (const message of recentMessages) {
      if (message.role === 'assistant') {
        // Look for property names in assistant's previous responses
        const propertyNames = ['Lincoln Court', '459 Rock', 'Rock Apartments'];
        
        for (const propertyName of propertyNames) {
          if (message.content.includes(propertyName)) {
            // Check if current message is asking about this property
            const propertyKeywords = propertyName.toLowerCase().split(' ');
            const hasPropertyKeywords = propertyKeywords.some(keyword => 
              lowerMessage.includes(keyword)
            );
            
            if (hasPropertyKeywords || this.isFollowUpQuestion(lowerMessage)) {
              return propertyName;
            }
          }
        }
      }
    }
    
    return null;
  }

  // Check if message is a follow-up question about a specific property
  private isFollowUpQuestion(message: string): boolean {
    const followUpIndicators = [
      'what about', 'how about', 'what is', 'what are', 'tell me about',
      'what\'s the', 'what are the', 'does it have', 'is there',
      'rent', 'deposit', 'fee', 'pet', 'utility', 'appliance',
      'bedroom', 'bathroom', 'square feet', 'available'
    ];
    
    return followUpIndicators.some(indicator => message.includes(indicator));
  }

  // Record performance metrics
  private recordMetrics(metrics: PerformanceMetrics) {
    this.performanceMetrics.push(metrics);
    
    // Keep only recent metrics
    if (this.performanceMetrics.length > this.maxMetricsHistory) {
      this.performanceMetrics = this.performanceMetrics.slice(-this.maxMetricsHistory);
    }
    
    // Log performance alerts
    if (metrics.totalLatency > 2000) {
      console.warn(`⚠️  SLOW RESPONSE: ${metrics.totalLatency}ms total latency`);
    }
    
    if (metrics.openaiLatency > 5000) {
      console.warn(`⚠️  SLOW OPENAI: ${metrics.openaiLatency}ms OpenAI latency`);
    }
    
    if (metrics.redisLatency > 1000) {
      console.warn(`⚠️  SLOW REDIS: ${metrics.redisLatency}ms Redis latency`);
    }
  }

  // Get performance statistics
  getPerformanceStats() {
    if (this.performanceMetrics.length === 0) {
      return { message: 'No performance data available' };
    }
    
    const totalRequests = this.performanceMetrics.length;
    const avgTotalLatency = this.performanceMetrics.reduce((sum, m) => sum + m.totalLatency, 0) / totalRequests;
    const avgRedisLatency = this.performanceMetrics.reduce((sum, m) => sum + m.redisLatency, 0) / totalRequests;
    const avgOpenAILatency = this.performanceMetrics.reduce((sum, m) => sum + m.openaiLatency, 0) / totalRequests;
    const cacheHitRate = this.performanceMetrics.filter(m => m.cacheHit).length / totalRequests;
    
    return {
      totalRequests,
      avgTotalLatency: Math.round(avgTotalLatency),
      avgRedisLatency: Math.round(avgRedisLatency),
      avgOpenAILatency: Math.round(avgOpenAILatency),
      cacheHitRate: Math.round(cacheHitRate * 100),
      cacheSize: this.responseCache.size,
      cacheMax: this.responseCache.max
    };
  }

  // Determine query type for optimized search
  private determineQueryType(userMessage: string): 'exact' | 'semantic' | 'hybrid' {
    const lowerMessage = userMessage.toLowerCase();
    
    // Check for general property queries (should use exact search)
    const generalQueries = ['what properties', 'show me properties', 'all properties', 'list properties', 'available properties'];
    const isGeneralQuery = generalQueries.some(term => lowerMessage.includes(term));
    
    if (isGeneralQuery) return 'exact';
    
    // Check for exact filters
    const exactFilters = ['bed', 'bath', 'rent', 'price', 'pet', 'dog', 'cat'];
    const hasExactFilters = exactFilters.some(filter => lowerMessage.includes(filter));
    
    // Check for semantic terms
    const semanticTerms = ['apartment', 'house', 'property', 'available', 'looking for'];
    const hasSemanticTerms = semanticTerms.some(term => lowerMessage.includes(term));
    
    if (hasExactFilters && hasSemanticTerms) return 'hybrid';
    if (hasExactFilters) return 'exact';
    return 'semantic';
  }

  // Generate intelligent fallback response
  private generateFallbackResponse(properties: TruncatedProperty[]): string {
    if (properties.length === 0) {
      return "I don't have any properties available at the moment. Please try again later or contact us for assistance.";
    }
    
    const property = properties[0];
    return `I found ${properties.length} properties available:

**${property.property_name}**
- **Address**: ${property.address.raw}
- **Unit Details**: ${property.unit_details.beds} bed, ${property.unit_details.baths} bath, $${property.rental_terms.rent}/month
- **Available**: ${property.unit_details.available}
- **Pet Policy**: ${property.pet_policy.pets_allowed.allowed ? 'Pet Friendly' : 'No Pets'}

This property is located in ${property.address.city}. Please contact us for more details or to schedule a viewing.`;
  }
} 