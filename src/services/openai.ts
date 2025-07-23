import OpenAI from 'openai';
import { config } from '../config';
import { Property, SearchQuery } from '../types';
import { Logger } from '../utils/logger';

export class OpenAIService {
  private client: OpenAI;
  private responseCache = new Map<string, string>();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
      // Performance optimizations
      timeout: 8000, // 8 second timeout for faster responses
      maxRetries: 2, // Reduce retries for faster failure
    });
  }

  // Simplified retry with backoff
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    const nonRetryableErrors = [400, 401, 403];
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        // Don't retry on client errors
        if (nonRetryableErrors.includes(error?.status)) {
          console.error(`❌ OpenAI error (not retrying): ${error.status} - ${error.message}`);
          throw error;
        }
        
        // Handle rate limiting
        if (error?.status === 429) {
          const retryAfter = error.headers?.['retry-after'] || baseDelay;
          console.warn(`⚠️ Rate limit hit, retrying after ${retryAfter}ms`);
          await new Promise(resolve => setTimeout(resolve, retryAfter));
          continue;
        }
        
        // Last attempt or no more retries
        if (attempt === maxRetries) {
          console.error(`❌ OpenAI failed after ${maxRetries + 1} attempts:`, error);
          throw error;
        }
        
        // Exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`⚠️ Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw new Error('Unexpected retry loop exit');
  }

  // Fast chat completion with optimizations and retry logic
  async chat(messages: any[], stream = false): Promise<{ content: string; usage: any } | any> {
    const cacheKey = this.generateCacheKey(messages);
    
    // Check cache first (only for non-streaming)
    if (!stream) {
      const cached = this.responseCache.get(cacheKey);
      if (cached) {
        console.log('📦 Using cached response');
        return { content: cached, usage: null };
      }
    }

    const startTime = Date.now();
    
    try {
      const response = await this.retryWithBackoff(async () => {
        return await this.client.chat.completions.create({
          model: config.openai.model,
          messages,
          stream: stream,
          max_tokens: 300, // Increased for better responses
          temperature: 0.1, // Very low for consistent, fast responses
          presence_penalty: 0, // Disable for faster generation
          frequency_penalty: 0, // Disable for faster generation
        });
      });

      const responseTime = Date.now() - startTime;
      console.log(`⚡ OpenAI response time: ${responseTime}ms`);

      if (stream) {
        return response;
      } else {
        // Handle non-streaming response properly
        if (response && typeof response === 'object' && 'choices' in response) {
          const typedResponse = response as any;
          const content = typedResponse.choices[0]?.message?.content || '';
          const usage = typedResponse.usage || null;
          
          // Cache the response
          this.responseCache.set(cacheKey, content);
          setTimeout(() => this.responseCache.delete(cacheKey), this.cacheTimeout);
          
          return { content, usage };
        } else {
          console.error('❌ Unexpected response format:', response);
          return { content: 'Sorry, I encountered an error processing your request.', usage: null };
        }
      }
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw error;
    }
  }

  // Generate cache key for messages
  private generateCacheKey(messages: any[]): string {
    return messages.map(m => `${m.role}:${m.content}`).join('|');
  }

  // Streaming chat completion for real-time responses with retry logic
  async chatStream(messages: any[]) {
    return await this.retryWithBackoff(async () => {
      return await this.client.chat.completions.create({
        model: config.openai.model,
        messages,
        stream: true,
        max_tokens: 300, // Reduced for faster streaming responses
        temperature: 0.1, // Consistent with non-streaming
        presence_penalty: 0,
        frequency_penalty: 0,
      });
    });
  }

  // Fast embeddings for semantic search with retry logic
  async getEmbedding(text: string): Promise<number[]> {
    const response = await this.retryWithBackoff(async () => {
      return await this.client.embeddings.create({
        model: config.openai.embeddingModel,
        input: text
      });
    });

    return response.data[0]?.embedding || [];
  }

  // Batch embeddings for multiple texts - optimized for data loading
  async getEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await this.retryWithBackoff(async () => {
      return await this.client.embeddings.create({
        model: config.openai.embeddingModel,
        input: texts
      });
    });

    return response.data.map(item => item.embedding || []);
  }

  // Analyze query type for hybrid search - optimized
  async analyzeQuery(query: string): Promise<'exact' | 'semantic' | 'hybrid'> {
    // Simple rule-based analysis for speed
    const lowerQuery = query.toLowerCase();
    
    // Check for general property queries (should use exact search)
    const generalQueries = ['what properties', 'show me properties', 'all properties', 'list properties', 'available properties'];
    const isGeneralQuery = generalQueries.some(term => lowerQuery.includes(term));
    
    if (isGeneralQuery) return 'exact';
    
    // Check for exact filters
    const exactFilters = ['bed', 'bath', 'rent', 'price', 'pet', 'dog', 'cat'];
    const hasExactFilters = exactFilters.some(filter => lowerQuery.includes(filter));
    
    // Check for semantic terms
    const semanticTerms = ['apartment', 'house', 'property', 'available', 'looking for'];
    const hasSemanticTerms = semanticTerms.some(term => lowerQuery.includes(term));
    
    if (hasExactFilters && hasSemanticTerms) return 'hybrid';
    if (hasExactFilters) return 'exact';
    return 'semantic';
  }

  // Generate property search filters from query - optimized
  async extractFilters(query: string): Promise<SearchQuery['filters']> {
    const lowerQuery = query.toLowerCase();
    const filters: SearchQuery['filters'] = {};
    
    // Fast rule-based extraction
    if (lowerQuery.includes('pet') || lowerQuery.includes('dog') || lowerQuery.includes('cat')) {
      filters.pets_allowed = true;
    }
    
    if (lowerQuery.includes('portland')) {
      filters.city = 'portland';
    }
    
    // Extract numbers for beds/baths
    const bedMatch = lowerQuery.match(/(\d+)\s*(bed|bedroom)/);
    if (bedMatch) {
      filters.beds = parseInt(bedMatch[1]);
    }
    
    const bathMatch = lowerQuery.match(/(\d+)\s*(bath|bathroom)/);
    if (bathMatch) {
      filters.baths = parseInt(bathMatch[1]);
    }
    
    // Extract rent range
    const rentMatch = lowerQuery.match(/\$(\d+)/);
    if (rentMatch) {
      filters.rent = { min: parseInt(rentMatch[1]) };
    }
    
    return filters;
  }

  // Clear cache
  clearCache() {
    this.responseCache.clear();
  }

  // Health check method
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.client.models.list();
      return response.data.length > 0;
    } catch (error) {
      Logger.error(`OpenAI connection test failed: ${error}`);
      return false;
    }
  }
} 