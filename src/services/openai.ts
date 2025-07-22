import OpenAI from 'openai';
import { config } from '../config';
import { Property, SearchQuery } from '../types';

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

  // Fast chat completion with optimizations
  async chat(messages: any[], stream = false): Promise<{ content: string; usage: any } | any> {
    const cacheKey = this.generateCacheKey(messages);
    
    // Check cache first
    const cached = this.responseCache.get(cacheKey);
    if (cached) {
      console.log('📦 Using cached response');
      return { content: cached, usage: null };
    }

    const startTime = Date.now();
    
    try {
      const response = await this.client.chat.completions.create({
        model: config.openai.model,
        messages,
        stream,
        max_tokens: 1000, // Restored for complete responses
        temperature: 0.1, // Very low for consistent, fast responses
        presence_penalty: 0, // Disable for faster generation
        frequency_penalty: 0, // Disable for faster generation
      });

      const responseTime = Date.now() - startTime;
      console.log(`⚡ OpenAI response time: ${responseTime}ms`);

      if (stream) {
        return response;
      } else {
        // Type guard to ensure we have a non-stream response
        if ('choices' in response) {
          const content = response.choices[0]?.message?.content || '';
          const usage = response.usage;
          
          // Cache the response
          this.responseCache.set(cacheKey, content);
          setTimeout(() => this.responseCache.delete(cacheKey), this.cacheTimeout);
          
          return { content, usage };
        }
        return { content: '', usage: null };
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

  // Streaming chat completion for real-time responses
  async chatStream(messages: any[]) {
    return await this.client.chat.completions.create({
      model: config.openai.model,
      messages,
      stream: true,
      max_tokens: 1000, // Restored for complete streaming responses
      temperature: 0.3,
      presence_penalty: 0,
      frequency_penalty: 0,
    });
  }

  // Fast embeddings for semantic search
  async getEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: config.openai.embeddingModel,
      input: text
    });

    return response.data[0]?.embedding || [];
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
} 