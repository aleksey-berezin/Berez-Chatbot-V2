import { v4 as uuidv4 } from 'uuid';
import { LRUCache } from 'lru-cache';
import { RedisService } from './redis';
import { OpenAIService } from './openai';
import { ChatMessage, ChatSession, Property, SearchQuery } from '../types';
import { Logger } from '../utils/logger';
import { ResponseGenerator, ResponseContext, ResponseResult, TruncatedProperty } from './response-generator';

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

// In-memory cache for property markdown links
const propertyLinkCache: Record<string, {view: string, tour: string, apply: string}> = {};

function getUnitLabel(property: any) {
  if (property.unit_details && property.unit_details.unit_number) {
    return `Unit ${property.unit_details.unit_number}`;
  }
  return '';
}

function cachePropertyLinks(property: any) {
  const name = property.property_name || '';
  const unit = getUnitLabel(property);
  const label = [name, unit].filter(Boolean).join(' ');
  propertyLinkCache[property.listing_urls.listing_id] = {
    view: `[View Details for ${label}](${property.listing_urls.view_details_url})`,
    tour: `[Schedule a tour for ${label}](${property.listing_urls.schedule_showing_url})`,
    apply: `[Apply now for ${label}](${property.listing_urls.apply_now_url})`
  };
  Logger.debug(`Cached links for property ${property.listing_urls.listing_id}: ${label}`);
}

// On property load/update, cache links
function cacheAllPropertyLinks(properties: any[]) {
  Logger.debug(`Caching links for ${properties.length} properties`);
  properties.forEach(cachePropertyLinks);
  Logger.debug(`Property link cache now has ${Object.keys(propertyLinkCache).length} entries`);
}

export class ChatbotService {
  private redis: RedisService;
  private openai: OpenAIService;
  private responseGenerator: ResponseGenerator;
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
    this.responseGenerator = ResponseGenerator.getInstance();
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
  private truncatePropertyData(properties: Property[], maxTokens: number = 4000): TruncatedProperty[] {
    const truncatedProperties: TruncatedProperty[] = properties.map(p => ({
      property_name: p.property_name,
      address: p.address,
      unit_details: p.unit_details,
      rental_terms: p.rental_terms,
      pet_policy: p.pet_policy,
      utilities_included: p.utilities_included,
      appliances: p.appliances,
      photos: p.photos,
      listing_urls: p.listing_urls,
      special_offer: p.special_offer
      // Include ALL data for comprehensive responses
    }));

    // Estimate total tokens
    const jsonString = JSON.stringify(truncatedProperties);
    const estimatedTokens = this.estimateTokens(jsonString);
    
    Logger.debug(`Token estimation: ${estimatedTokens} tokens for ${properties.length} properties`);
    
    // If still too large, reduce number of properties
    if (estimatedTokens > maxTokens) {
      const maxProperties = Math.floor((maxTokens / estimatedTokens) * properties.length);
      Logger.debug(`Truncating from ${properties.length} to ${maxProperties} properties`);
      return truncatedProperties.slice(0, maxProperties);
    }
    
    return truncatedProperties;
  }

  // Main chat handler - optimized for performance
  async handleMessage(sessionId: string, userMessage: string): Promise<string> {
    const startTime = Date.now();
    let metrics: PerformanceMetrics = {
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
        Logger.debug('Using cached response');
        metrics.cacheHit = true;
        metrics.totalLatency = Date.now() - startTime;
        this.recordMetrics(metrics);
        return cached.response;
      }

      // Get or create session
      const session = await this.getOrCreateSession(sessionId);
      
      // OPTIMIZED: Single Redis search followed by single OpenAI call
      Logger.debug('Starting optimized single-pass operations...');
      
      // ULTRA-FAST: Direct property access
      const redisStart = Date.now();
      const searchResult = await this.redis.searchProperties({
        type: 'exact',
        query: userMessage,
        filters: this.extractFilters(userMessage)
      });
      metrics.redisLatency = searchResult.latency || (Date.now() - redisStart);
      Logger.debug(`Found ${searchResult.properties?.length || 0} properties in ${metrics.redisLatency}ms`);
      
      // After loading properties from Redis, cache their links
      if (searchResult.properties && searchResult.properties.length > 0) {
        cacheAllPropertyLinks(searchResult.properties);
      }
      
      // If no properties found, get all properties
      if (!searchResult.properties || searchResult.properties.length === 0) {
        Logger.debug('No properties found, getting all properties...');
        const allPropertiesResult = await this.redis.searchProperties({
          type: 'exact',
          query: '*',
          filters: {}
        });
        
        if (allPropertiesResult.properties && allPropertiesResult.properties.length > 0) {
          Logger.debug(`Found ${allPropertiesResult.properties.length} total properties`);
          searchResult.properties = allPropertiesResult.properties;
        } else {
          const response = "I don't have any properties available at the moment. Please try again later or contact us for assistance.";
          metrics.totalLatency = Date.now() - startTime;
          this.recordMetrics(metrics);
          return response;
        }
      }
      
      // Use OpenAI for intelligent responses
      const truncatedProperties = this.truncatePropertyData(searchResult.properties, 4000);
      metrics.propertiesFound = truncatedProperties.length;
      
      // Prepare comprehensive context for OpenAI with full property data
      const messages = [
        {
          role: 'system' as const,
          content: `You are a fast, friendly, and conversion-focused real estate assistant for Lincoln Court. Greet the user by name if possible. Your job is to help prospective tenants find their perfect home and guide them toward scheduling tours or applying.

Key principles:
- Respond in 1-2 short, engaging sentences ONLY
- Create urgency for available units ("These go fast!")
- Provide clear, simple next steps ("Schedule a tour" or "Apply now")
- Be helpful, never verbose
- Always answer the user's question directly—do not just list properties
- Do NOT generate or format links. Only refer to properties by name and unit number. The system will insert the correct links.

For property queries:
1. Brief excitement about available units
2. Only the most relevant details (price, location, availability)
3. End with a clear CTA

If the user greets you, greet them back and offer to help find a home or answer questions.
If the user asks a specific question, answer it directly and then offer a next step.

Keep responses EXTREMELY FAST, CONCISE, and CONVERSION-FOCUSED.`
        },
        {
          role: 'user' as const,
          content: `Question: ${userMessage}\n\nProperties: ${JSON.stringify(truncatedProperties)}\n\nUse the EXACT format above with basic info only.`
        }
      ];
      
      // Generate OpenAI response
      let response = '';
      let usage = null;
             if (truncatedProperties.length > 0) {
         Logger.debug('Using OpenAI for property response...');
         const openaiStart = Date.now();
         
         try {
           const aiResponse = await this.openai.chat(messages, true);
           response = typeof aiResponse === 'object' && 'content' in aiResponse ? aiResponse.content : '';
           usage = typeof aiResponse === 'object' && 'usage' in aiResponse ? aiResponse.usage : null;
           
           Logger.debug('OpenAI call successful');
         } catch (error) {
           Logger.error(`OpenAI call failed: ${error}`);
           response = "I'm having trouble processing your request right now. Please try again.";
         }
         
         metrics.openaiLatency = Date.now() - openaiStart;
       } else {
         // No properties found - use OpenAI for general response
         Logger.debug('No properties found, using OpenAI for general response...');
         const openaiStart = Date.now();
         
         try {
           const generalMessages = [
             {
               role: 'system' as const,
               content: `You are a helpful real estate assistant. The user is asking about properties but none were found. Apologize briefly and suggest they try a different search or contact us.`
             },
             {
               role: 'user' as const,
               content: userMessage
             }
           ];
           
           const aiResponse = await this.openai.chat(generalMessages, true);
           response = typeof aiResponse === 'object' && 'content' in aiResponse ? aiResponse.content : '';
           usage = typeof aiResponse === 'object' && 'usage' in aiResponse ? aiResponse.usage : null;
           
           Logger.debug('OpenAI call successful');
         } catch (error) {
           Logger.error(`OpenAI call failed: ${error}`);
           response = "I don't have any properties available at the moment. Please try again later or contact us for assistance.";
         }
         
         metrics.openaiLatency = Date.now() - openaiStart;
       }
      
      // When generating a response, use cached links for up to 2 properties
      if (truncatedProperties && truncatedProperties.length > 0) {
        let fixedResponse = response;
        truncatedProperties.slice(0, 2).forEach((p) => {
          const links = propertyLinkCache[p.listing_urls.listing_id];
          if (links) {
            fixedResponse = fixedResponse.replace(new RegExp(`\[View Details[^\]]*\]\([^)]*\)`, 'g'), links.view);
            fixedResponse = fixedResponse.replace(new RegExp(`\[Schedule a tour[^\]]*\]\([^)]*\)`, 'g'), links.tour);
            fixedResponse = fixedResponse.replace(new RegExp(`\[Apply now[^\]]*\]\([^)]*\)`, 'g'), links.apply);
          }
        });
        
        // If no links were found in the response, append them for the top 2 properties
        if (!fixedResponse.includes('[Schedule a tour]') && !fixedResponse.includes('[Apply now]')) {
          truncatedProperties.slice(0, 2).forEach((p) => {
            const links = propertyLinkCache[p.listing_urls.listing_id];
            if (links) {
              fixedResponse += `\n\n${links.tour} | ${links.apply}`;
            }
          });
        }
        
        response = fixedResponse;
      }
      
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
      Logger.debug(`Performance Summary: Total=${metrics.totalLatency}ms, Redis=${metrics.redisLatency}ms, OpenAI=${metrics.openaiLatency}ms, Properties=${metrics.propertiesFound}, Cache=${metrics.cacheHit}`);
      
      session.updatedAt = Date.now();
      
      // Store session asynchronously (don't wait for it)
      this.redis.storeSession(session).catch(err => 
        console.error('Failed to store session:', err)
      );
      
      // Log comprehensive metrics
      Logger.debug(`RAG Metrics: "${userMessage}", Found=${metrics.propertiesFound}, Redis=${metrics.redisLatency}ms, OpenAI=${metrics.openaiLatency}ms, Total=${metrics.totalLatency}ms`);

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
        
        Logger.debug(`Token Usage: ${totalTokens}/${maxTokens} (${tokenPercentage}%), Prompt=${promptTokens}, Completion=${completionTokens}`);
      } else {
        Logger.debug(`Response length: ${response.length} characters`);
      }
      
      Logger.debug(`Session: ${sessionId} (${session.messages.length} messages), Cache: ${this.responseCache.size}/${this.responseCache.max}`);
      
      // Cache the response
      this.responseCache.set(cacheKey, { response, timestamp: Date.now() });
      
      // Record metrics
      this.recordMetrics(metrics);
      
      // Log Q&A and metrics
      Logger.info(`Q&A Log | sessionId=${sessionId} | user="${userMessage}" | ai="${response}" | metrics=${JSON.stringify(metrics)}`);
      
      return response;
      
    } catch (error) {
      console.error('Chat error:', error);
      metrics.totalLatency = Date.now() - startTime;
      this.recordMetrics(metrics);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  // Streaming chat handler - uses same logic as handleMessage but streams the response
  async handleMessageStream(sessionId: string, userMessage: string) {
    const startTime = Date.now();

    try {
      // Ensure Redis connection
      if (!this.isConnected) {
        await this.connect();
      }

      // Get or create session
      const session = await this.getOrCreateSession(sessionId);
      
      // Use same logic as handleMessage for consistency
      const searchResult = await this.redis.searchProperties({
        type: 'exact',
        query: userMessage,
        filters: this.extractFilters(userMessage)
      });
      
      // After loading properties from Redis, cache their links
      Logger.debug(`Search result properties: ${searchResult.properties?.length || 0} properties found`);
      if (searchResult.properties && searchResult.properties.length > 0) {
        Logger.debug(`Caching properties with IDs: ${searchResult.properties.map(p => p.listing_urls?.listing_id || 'NO_ID').join(', ')}`);
        cacheAllPropertyLinks(searchResult.properties);
      } else {
        Logger.debug('No properties found in search result');
      }
      
      // If no properties found, get all properties
      if (!searchResult.properties || searchResult.properties.length === 0) {
        const allPropertiesResult = await this.redis.searchProperties({
          type: 'exact',
          query: '*',
          filters: {}
        });
        
        if (allPropertiesResult.properties && allPropertiesResult.properties.length > 0) {
          searchResult.properties = allPropertiesResult.properties;
        }
      }
      
      // Use OpenAI for intelligent responses (same logic as regular handleMessage)
      const truncatedProperties = this.truncatePropertyData(searchResult.properties, 4000);
      
      const messages = [
        {
          role: 'system' as const,
          content: `You are a fast, friendly, and conversion-focused real estate assistant for Lincoln Court. Greet the user by name if possible. Your job is to help prospective tenants find their perfect home and guide them toward scheduling tours or applying.

Key principles:
- Respond in 1-2 short, engaging sentences ONLY
- Create urgency for available units ("These go fast!")
- Provide clear, simple next steps ("Schedule a tour" or "Apply now")
- Be helpful, never verbose
- Always answer the user's question directly—do not just list properties
- Do NOT generate or format links. Only refer to properties by name and unit number. The system will insert the correct links.

For property queries:
1. Brief excitement about available units
2. Only the most relevant details (price, location, availability)
3. End with a clear CTA

If the user greets you, greet them back and offer to help find a home or answer questions.
If the user asks a specific question, answer it directly and then offer a next step.

Keep responses EXTREMELY FAST, CONCISE, and CONVERSION-FOCUSED.`
        },
        {
          role: 'user' as const,
          content: `Question: ${userMessage}\n\nProperties: ${JSON.stringify(truncatedProperties)}\n\nUse the EXACT format above with basic info only.`
        }
      ];
      
      let response = '';
      let usage = null;
      let metrics: PerformanceMetrics = {
        redisLatency: 0,
        openaiLatency: 0,
        totalLatency: 0,
        cacheHit: false,
        propertiesFound: 0
      };

      const greetingRegex = /^(hello|hi|hey|greetings|good morning|good afternoon|good evening)[!,. ]*$/i;
      if (greetingRegex.test(userMessage.trim())) {
        const greetingResponse = "Hi there! I'm your Lincoln Court assistant. I can help you find available apartments, answer questions about our properties, or guide you to schedule a tour or apply. What would you like to do today?";
        metrics.totalLatency = Date.now() - startTime;
        Logger.info(`Q&A Log | sessionId=${sessionId} | user="${userMessage}" | ai="${greetingResponse}" | metrics=${JSON.stringify(metrics)}`);
        
        // Return a stream for the greeting response
        return new ReadableStream({
          async start(controller) {
            for (let i = 0; i < greetingResponse.length; i++) {
              const chunk = greetingResponse[i];
              controller.enqueue(new TextEncoder().encode(chunk));
              await new Promise(resolve => setTimeout(resolve, 20));
            }
            controller.close();
          }
        });
      }

      try {
        const openaiStart = Date.now();
        // Use non-streaming for content extraction, then convert to stream
        const aiResponse = await this.openai.chat(messages, false);
        response = typeof aiResponse === 'object' && 'content' in aiResponse ? aiResponse.content : '';
        usage = typeof aiResponse === 'object' && 'usage' in aiResponse ? aiResponse.usage : null;
        metrics.openaiLatency = Date.now() - openaiStart;

        Logger.debug('OpenAI call successful');
      } catch (error) {
        console.error('OpenAI error in streaming:', error);
        response = "I'm having trouble processing your request right now. Please try again.";
        metrics.openaiLatency = Date.now() - startTime; // Set openaiLatency to total time
      }
      
      // Add token usage if available
      if (usage) {
        metrics.tokenUsage = {
          total: usage.total_tokens || 0,
          prompt: usage.prompt_tokens || 0,
          completion: usage.completion_tokens || 0,
          percentage: 0
        };
      }

      // Apply link replacement for streaming responses
      if (truncatedProperties && truncatedProperties.length > 0) {
        Logger.debug(`Link replacement: Found ${truncatedProperties.length} properties, cache has ${Object.keys(propertyLinkCache).length} entries`);
        
        // Ensure properties are cached even if using LangCache
        if (Object.keys(propertyLinkCache).length === 0) {
          Logger.debug('Property cache is empty, caching properties now');
          cacheAllPropertyLinks(truncatedProperties);
        }
        
        let fixedResponse = response;
        truncatedProperties.slice(0, 2).forEach((p) => {
          const links = propertyLinkCache[p.listing_urls.listing_id];
          if (links) {
            Logger.debug(`Replacing links for property ${p.listing_urls.listing_id}`);
            fixedResponse = fixedResponse.replace(new RegExp(`\\[View Details[^\\]]*\\]\\([^)]*\\)`, 'g'), links.view);
            fixedResponse = fixedResponse.replace(new RegExp(`\\[Schedule a tour[^\\]]*\\]\\([^)]*\\)`, 'g'), links.tour);
            fixedResponse = fixedResponse.replace(new RegExp(`\\[Apply now[^\\]]*\\]\\([^)]*\\)`, 'g'), links.apply);
          } else {
            Logger.debug(`No cached links found for property ${p.listing_urls.listing_id}`);
          }
        });
        
        // If no links were found in the response, append them for the top property only
        if (!fixedResponse.includes('[View Details]') && !fixedResponse.includes('[Schedule a tour]') && !fixedResponse.includes('[Apply now]')) {
          Logger.debug('No links in response, appending default links');
          // Only show the first property to avoid overwhelming the user
          const topProperty = truncatedProperties[0];
          if (topProperty) {
            const links = propertyLinkCache[topProperty.listing_urls.listing_id];
            if (links) {
              fixedResponse += `\n\n${links.view} | ${links.tour} | ${links.apply}`;
              Logger.debug(`Appended links for ${topProperty.listing_urls.listing_id}`);
            }
          }
        }
        
        response = fixedResponse;
        Logger.debug(`Final response length: ${response.length} characters`);
      }

      // Log Q&A and metrics for streaming
      Logger.info(`Q&A Log | sessionId=${sessionId} | user="${userMessage}" | ai="${response}" | metrics=${JSON.stringify(metrics)}`);

      // Convert the response to a stream
      const stream = new ReadableStream({
        async start(controller) {
          // Ensure response is a string
          const safeResponse = response || "I'm having trouble responding right now. Please try again.";
          
          // Stream the response in larger chunks for faster delivery
          const chunkSize = 10; // Send 10 characters at a time
          for (let i = 0; i < safeResponse.length; i += chunkSize) {
            const chunk = safeResponse.slice(i, i + chunkSize);
            controller.enqueue(new TextEncoder().encode(chunk));
            await new Promise(resolve => setTimeout(resolve, 5)); // Reduced delay
          }
          
          controller.close();
        }
      });
      
      return stream;
      
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
  private determineQueryType(userMessage: string): 'exact' | 'semantic' | 'hybrid' | 'choice' | 'action' {
    const lowerMessage = userMessage.toLowerCase();
    
    // Check for action requests (tour, apply, details)
    if (lowerMessage.includes('tour') || lowerMessage.includes('schedule') || lowerMessage.includes('visit') ||
        lowerMessage.includes('apply') || lowerMessage.includes('application') || lowerMessage.includes('apply now') ||
        lowerMessage.includes('details') || lowerMessage.includes('more info') || lowerMessage.includes('show me')) {
      return 'action';
    }
    
    // Check for choice responses
    if (lowerMessage.includes('option 1') || lowerMessage.includes('option 2') ||
        lowerMessage.includes('option 3') || lowerMessage.includes('option 4') ||
        lowerMessage.includes('1') || lowerMessage.includes('2') ||
        lowerMessage.includes('3') || lowerMessage.includes('4') ||
        lowerMessage.includes('first') || lowerMessage.includes('second') ||
        lowerMessage.includes('third') || lowerMessage.includes('fourth')) {
      return 'choice';
    }
    
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

  // Response generation is now handled by the shared ResponseGenerator service
} 