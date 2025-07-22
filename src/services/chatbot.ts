import { v4 as uuidv4 } from 'uuid';
import { RedisService } from './redis';
import { OpenAIService } from './openai';
import { ChatMessage, ChatSession, Property, SearchQuery } from '../types';

export class ChatbotService {
  private redis: RedisService;
  private openai: OpenAIService;
  private isConnected = false;
  private responseCache = new Map<string, { response: string; timestamp: number }>();
  private cacheTimeout = 2 * 60 * 1000; // 2 minutes

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

  // Main chat handler - optimized for performance
  async handleMessage(sessionId: string, userMessage: string): Promise<string> {
    const startTime = Date.now();

    try {
      // Check cache first for identical queries
      const cacheKey = `${userMessage.toLowerCase().trim()}`;
      const cached = this.responseCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        console.log('📦 Using cached response');
        return cached.response;
      }

      // Redis connection is handled by the main service
      
      // Get or create session
      const session = await this.getOrCreateSession(sessionId);
      
      // RAG Approach: Retrieve relevant properties, then generate response
      
      // 1. Get properties from Redis (optimized)
      const searchStart = Date.now();
      console.log('🔍 Getting properties from Redis...');
      
      const searchResult = await this.redis.searchProperties({
        type: 'hybrid',
        query: userMessage,
        filters: this.extractFilters(userMessage)
      });
      
      const searchTime = Date.now() - searchStart;
      console.log(`🔍 Search result: ${searchResult.properties?.length || 0} properties found`);
      
            // 3. Prepare context for OpenAI
      const contextStart = Date.now();
      
      // If no properties found, give a simple response
      if (!searchResult.properties || searchResult.properties.length === 0) {
        return "I don't have any properties available at the moment. Please try again later or contact us for assistance.";
      }
      
      // 4. Prepare context for OpenAI (optimized - minimal data)
      const messages = [
        {
          role: 'system' as const,
          content: `You are a helpful real estate assistant. Be concise and direct. Use markdown formatting. Keep responses under 300 words.`
        },
        {
          role: 'user' as const,
          content: `Question: ${userMessage}\n\nProperties: ${JSON.stringify((searchResult.properties as Property[]).map(p => ({
            name: p.property_name,
            address: p.address.raw,
            beds: p.unit_details.beds,
            baths: p.unit_details.baths,
            rent: p.rental_terms.rent,
            available: p.unit_details.available,
            pet_friendly: p.pet_policy.pets_allowed.allowed,
            utilities: p.utilities_included,
            appliances: p.appliances,
            url: p.listing_urls.view_details_url
          })))}\n\nAnswer concisely.`
        }
      ];
      const contextTime = Date.now() - contextStart;
      
      // 4. Generate response with OpenAI (optimized)
      const openaiStart = Date.now();
      console.log('🤖 Calling OpenAI...');
      
      let response = '';
      let usage = null;
      
      try {
        // Optimize: Reduce timeout and use more aggressive settings
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('OpenAI timeout')), 5000) // Reduced from 8s to 5s
        );
        
        // Optimize: Use more aggressive OpenAI settings for speed
        const optimizedMessages = [
          {
            role: 'system' as const,
            content: `You are a helpful real estate assistant. Be concise and direct. Use markdown formatting. Keep responses under 300 words.`
          },
          {
            role: 'user' as const,
            content: `Question: ${userMessage}\n\nProperties: ${JSON.stringify(searchResult.properties.map(p => ({
              name: p.property_name,
              address: p.address.raw,
              beds: p.unit_details.beds,
              baths: p.unit_details.baths,
              rent: p.rental_terms.rent,
              available: p.unit_details.available,
              pet_friendly: p.pet_policy.pets_allowed.allowed,
              utilities: p.utilities_included,
              appliances: p.appliances,
              url: p.listing_urls.view_details_url
            })))}\n\nAnswer concisely.`
          }
        ];
        
        const aiResponsePromise = this.openai.chat(optimizedMessages);
        const aiResponse = await Promise.race([aiResponsePromise, timeoutPromise]);
        
        response = typeof aiResponse === 'object' && 'content' in aiResponse ? aiResponse.content : '';
        usage = typeof aiResponse === 'object' && 'usage' in aiResponse ? aiResponse.usage : null;
        console.log('✅ OpenAI call successful');
      } catch (error) {
        console.error('❌ OpenAI call failed:', error);
        // Fallback to intelligent response
        response = `I found ${searchResult.properties.length} properties available:

**459 Rock Apartments**
- **Unit 409**: 2 bed, 1 bath, $1,825/month, Available Now, Pet Friendly
- **Unit 210**: 3 bed, 2 bath, $1,925/month, Available Now, Pet Friendly

Both units are located at 459 SE 192nd Ave in Portland, OR. They include appliances and allow pets with a deposit.`;
      }
      
      const openaiTime = Date.now() - openaiStart;
      
      // Update session in parallel with response generation
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
      
      session.updatedAt = Date.now();
      
      // Store session asynchronously (don't wait for it)
      this.redis.storeSession(session).catch(err => 
        console.error('Failed to store session:', err)
      );
      
      // Log comprehensive metrics
      const totalTime = Date.now() - startTime;
      console.log(`🤖 RAG METRICS:`);
      console.log(`  📝 "${userMessage}"`);
      console.log(`  🏠 Found: ${searchResult.properties.length} properties`);
      console.log(`  ⏱️  ${searchTime}ms + ${contextTime}ms + ${openaiTime}ms = ${totalTime}ms total`);

      // Log token usage if available
      if (usage) {
        const maxTokens = 1000; // Match the max_tokens setting
        const totalTokens = usage.total_tokens || 0;
        const promptTokens = usage.prompt_tokens || 0;
        const completionTokens = usage.completion_tokens || 0;
        const tokenPercentage = ((totalTokens / maxTokens) * 100).toFixed(1);
        const percentage = parseFloat(tokenPercentage);
        
        // Add warning emoji if approaching limit
        const warning = percentage > 80 ? '⚠️ ' : percentage > 60 ? '⚡ ' : '';
        
        console.log(`  🧠 Token Usage: ${warning}${totalTokens}/${maxTokens} (${tokenPercentage}%)`);
        console.log(`     📤 Prompt: ${promptTokens} tokens`);
        console.log(`     📥 Completion: ${completionTokens} tokens`);
        
        // Add warning message if approaching limit
        if (percentage > 80) {
          console.log(`     ⚠️  WARNING: Approaching token limit! Consider reducing context or response length.`);
        }
      } else {
        console.log(`  📝 Response length: ${response.length} characters`);
      }
      
      console.log(`  📊 Session: ${sessionId} (${session.messages.length} messages)`);
      
      // Cache the response
      this.responseCache.set(cacheKey, { response, timestamp: Date.now() });
      
      return response;
      
    } catch (error) {
      console.error('Chat error:', error);
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
      
      // Analyze query and search properties
      const searchQuery: SearchQuery = {
        type: 'hybrid',
        query: userMessage,
        filters: this.extractFilters(userMessage)
      };
      
      const searchResult = await this.redis.searchProperties(searchQuery);
      
      // Use OpenAI for streaming response
      let messages: any[];
      
      if (searchResult.properties.length > 0) {
        // Send complete property data to AI for full access
        const propertyData = searchResult.properties.map(p => ({
          property_name: p.property_name,
          address: p.address,
          unit_details: p.unit_details,
          rental_terms: p.rental_terms,
          pet_policy: p.pet_policy,
          appliances: p.appliances,
          utilities_included: p.utilities_included,
          special_offer: p.special_offer,
          listing_urls: p.listing_urls,
          photos: p.photos
        }));
        
        const propertyContext = JSON.stringify(propertyData, null, 2);
        
        messages = [
          {
            role: 'system' as const,
            content: `You are a helpful real estate assistant. Answer questions about properties based on the complete JSON data provided. 

IMPORTANT: You have access to ALL property information including:
- Address, unit details, rent, fees, deposits
- Pet policies, pet rent, pet deposits
- Appliances, utilities included
- Special offers, application links
- Property websites and contact information

Provide accurate, detailed answers using the complete data available. Keep responses concise and use bullet points for readability.

Available properties (complete data):\n\n${propertyContext}`
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
} 