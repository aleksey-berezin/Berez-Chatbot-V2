import { Property, SearchQuery, ListingUrls } from '../types';
import { Logger } from '../utils/logger';

// Shared response types
export interface ResponseContext {
  properties: Property[];
  userMessage: string;
  queryType: 'exact' | 'semantic' | 'hybrid' | 'choice' | 'action';
  sessionId: string;
}

export interface ResponseResult {
  content: string;
  type: 'property_list' | 'property_detail' | 'action_response' | 'general';
  metadata?: {
    propertyCount?: number;
    selectedProperty?: Property;
    actionType?: 'tour' | 'apply' | 'details';
  };
}

// Truncated property interface for consistent responses
export interface TruncatedProperty {
  property_name: string;
  address: {
    raw: string;
    city: string;
    state: string;
  };
  unit_details: {
    beds: number;
    baths: number;
    square_feet: number;
    available: string;
    floorplan_name?: string;
  };
  rental_terms: {
    rent: number;
    application_fee: number;
    security_deposit: number;
    flex_rent_program: boolean;
  };
  pet_policy: {
    pets_allowed: {
      allowed: boolean;
      allowed_types: string[];
    };
    pet_rent: number | null;
    pet_deposit: number | null;
  };
  utilities_included: string[];
  appliances: string[];
  photos: string[];
  listing_urls: ListingUrls;
  special_offer: {
    flag: boolean;
    text: string | null;
  };
}

export class ResponseGenerator {
  private static instance: ResponseGenerator;
  
  private constructor() {}
  
  public static getInstance(): ResponseGenerator {
    if (!ResponseGenerator.instance) {
      ResponseGenerator.instance = new ResponseGenerator();
    }
    return ResponseGenerator.instance;
  }

  // Main response generation method - single source of truth
  public generateResponse(context: ResponseContext): ResponseResult {
    const { properties, userMessage, queryType } = context;
    
    Logger.debug(`Generating response for query type: ${queryType}, properties: ${properties.length}`);
    
    // Truncate properties for consistent handling
    const truncatedProperties = this.truncatePropertyData(properties);
    
    switch (queryType) {
      case 'choice':
        return this.generateChoiceResponse(userMessage, truncatedProperties);
      case 'action':
        return this.generateActionResponse(userMessage, truncatedProperties);
      case 'exact':
      case 'semantic':
      case 'hybrid':
        return this.generatePropertyListResponse(truncatedProperties);
      default:
        return this.generateGeneralResponse(userMessage);
    }
  }

  // Generate property list response (initial property queries)
  private generatePropertyListResponse(properties: TruncatedProperty[]): ResponseResult {
    if (properties.length === 0) {
      return {
        content: "I don't have any properties available at the moment. Please try again later or contact us for assistance.",
        type: 'general'
      };
    }
    
    // Sort by availability
    const sortedProperties = properties.sort((a, b) => {
      const aAvailable = a.unit_details.available.toLowerCase().includes('now') ? 1 : 0;
      const bAvailable = b.unit_details.available.toLowerCase().includes('now') ? 1 : 0;
      return bAvailable - aAvailable;
    });
    
    const availableNow = sortedProperties.filter(p => 
      p.unit_details.available.toLowerCase().includes('now')
    ).length;
    
    let content = `🏠 **I found ${sortedProperties.length} perfect properties for you!**\n\n`;
    
    if (availableNow > 0) {
      content += `🔥 **${availableNow} are available NOW** - these won't last long!\n\n`;
    }
    
    sortedProperties.forEach((property, index) => {
      const availability = property.unit_details.available.toLowerCase().includes('now') 
        ? '🔥 **AVAILABLE NOW**' 
        : property.unit_details.available;
      
      const keyFeature = this.getKeyFeature(property);
      
      content += `**${index + 1}. ${property.property_name}**\n`;
      content += `📍 ${property.address.city}, ${property.address.state}\n`;
      content += `🏠 ${property.unit_details.beds} bed, ${property.unit_details.baths} bath, ${property.unit_details.square_feet} sq ft\n`;
      content += `💰 **$${property.rental_terms.rent}/month**\n`;
      content += `✨ ${keyFeature}\n`;
      content += `📅 ${availability}\n\n`;
    });
    
    content += `**Which one interests you most?** Just say the number (1, 2, 3, etc.) and I'll show you everything - including photos, floor plans, and how to schedule a tour! 🚀\n\n`;
    content += `*P.S. These units are getting lots of interest - I'd recommend acting fast!*`;
    
    return {
      content,
      type: 'property_list',
      metadata: {
        propertyCount: properties.length
      }
    };
  }

  // Generate choice response (detailed property info)
  private generateChoiceResponse(userMessage: string, properties: TruncatedProperty[]): ResponseResult {
    const selectedIndex = this.getSelectedPropertyIndex(userMessage);
    
    if (selectedIndex >= 0 && selectedIndex < properties.length) {
      const property = properties[selectedIndex];
      
      let content = `🏠 **${property.property_name}**\n\n`;
      
      // Key details only
      content += `📍 ${property.address.raw}\n`;
      content += `🏠 ${property.unit_details.beds} bed, ${property.unit_details.baths} bath, ${property.unit_details.square_feet} sq ft\n`;
      content += `💰 **$${property.rental_terms.rent}/month**\n`;
      content += `📅 ${property.unit_details.available}\n`;
      
      // Key selling point
      if (property.special_offer.flag) {
        content += `🎁 ${property.special_offer.text}\n`;
      } else if (property.pet_policy.pets_allowed.allowed) {
        content += `🐾 Pet friendly\n`;
      } else if (property.utilities_included.length > 0) {
        content += `💡 Utilities included\n`;
      }
      
      // Clear CTAs
      content += `\n**What would you like to do?**\n`;
      content += `• **Tour** - See it in person\n`;
      content += `• **Apply** - Start your application\n`;
      content += `• **Details** - More information\n`;
      
      if (property.unit_details.available.toLowerCase().includes('now')) {
        content += `\n🔥 *Available now - act fast!*`;
      }
      
      return {
        content,
        type: 'property_detail',
        metadata: {
          selectedProperty: property as any, // Type conversion for compatibility
          propertyCount: properties.length
        }
      };
    } else {
      const content = `Which property interests you? Just say the number:\n${properties.map((prop, index) => `${index + 1}. ${prop.property_name} - $${prop.rental_terms.rent}/month`).join('\n')}`;
      
      return {
        content,
        type: 'property_list',
        metadata: {
          propertyCount: properties.length
        }
      };
    }
  }

  // Generate action response (tour, apply, details)
  private generateActionResponse(userMessage: string, properties: TruncatedProperty[]): ResponseResult {
    const lowerMessage = userMessage.toLowerCase();
    
    if (properties.length === 0) {
      return this.generatePropertyListResponse(properties);
    }
    
    // Handle tour requests
    if (lowerMessage.includes('tour') || lowerMessage.includes('schedule') || lowerMessage.includes('visit')) {
      if (properties.length === 1) {
        const property = properties[0];
        const content = `🎉 **Tour scheduled for ${property.property_name}!**\n\n` +
                       `📍 ${property.address.raw}\n` +
                       `💰 $${property.rental_terms.rent}/month\n\n` +
                       `[Book Tour](${property.listing_urls.schedule_showing_url})\n` +
                       `📞 (555) 123-4567\n\n` +
                       `*This unit is popular - book soon!*`;
        
        return {
          content,
          type: 'action_response',
          metadata: {
            actionType: 'tour',
            selectedProperty: property as any
          }
        };
      } else {
        const content = `Which property would you like to tour?\n${properties.map((prop, index) => `${index + 1}. ${prop.property_name} - $${prop.rental_terms.rent}/month`).join('\n')}`;
        
        return {
          content,
          type: 'action_response',
          metadata: {
            actionType: 'tour',
            propertyCount: properties.length
          }
        };
      }
    }
    
    // Handle apply requests
    if (lowerMessage.includes('apply') || lowerMessage.includes('application')) {
      if (properties.length === 1) {
        const property = properties[0];
        const content = `🚀 **Apply for ${property.property_name}!**\n\n` +
                       `[Start Application](${property.listing_urls.apply_now_url})\n\n` +
                       `Fee: $${property.rental_terms.application_fee} | Deposit: $${property.rental_terms.security_deposit}\n\n` +
                       `*Apply today - could be approved in 24 hours!*`;
        
        return {
          content,
          type: 'action_response',
          metadata: {
            actionType: 'apply',
            selectedProperty: property as any
          }
        };
      } else {
        const content = `Which property would you like to apply for?\n${properties.map((prop, index) => `${index + 1}. ${prop.property_name} - $${prop.rental_terms.rent}/month`).join('\n')}`;
        
        return {
          content,
          type: 'action_response',
          metadata: {
            actionType: 'apply',
            propertyCount: properties.length
          }
        };
      }
    }
    
    // Handle details requests
    if (lowerMessage.includes('details') || lowerMessage.includes('more info') || lowerMessage.includes('show me')) {
      if (properties.length === 1) {
        return this.generateChoiceResponse('1', properties);
      } else {
        const content = `Which property interests you?\n${properties.map((prop, index) => `${index + 1}. ${prop.property_name} - $${prop.rental_terms.rent}/month`).join('\n')}`;
        
        return {
          content,
          type: 'action_response',
          metadata: {
            actionType: 'details',
            propertyCount: properties.length
          }
        };
      }
    }
    
    // Default response
    return {
      content: `What would you like to do?\n• **Tour** - See in person\n• **Apply** - Start application\n• **Details** - More info`,
      type: 'action_response'
    };
  }

  // Generate general response (when no properties found)
  private generateGeneralResponse(userMessage: string): ResponseResult {
    return {
      content: "I'm here to help you find your perfect home! What are you looking for? I can help with:\n\n• **Property search** - Find available units\n• **Tour scheduling** - See properties in person\n• **Application process** - Get started with renting\n\nJust let me know what you need!",
      type: 'general'
    };
  }

  // Helper methods
  private truncatePropertyData(properties: Property[]): TruncatedProperty[] {
    return properties.map(p => ({
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
    }));
  }

  private getKeyFeature(property: TruncatedProperty): string {
    if (property.special_offer.flag) {
      return `🎁 **Special Offer:** ${property.special_offer.text}`;
    }
    if (property.pet_policy.pets_allowed.allowed) {
      return `🐾 **Pet Friendly** - Your furry friends welcome!`;
    }
    if (property.unit_details.available.toLowerCase().includes('now')) {
      return `⚡ **Move-in Ready** - Available immediately!`;
    }
    if (property.utilities_included.length > 0) {
      return `💡 **Utilities Included** - Save money on bills!`;
    }
    return `🌟 **Prime Location** - Great amenities nearby!`;
  }

  private getSelectedPropertyIndex(userMessage: string): number {
    const lowerMessage = userMessage.toLowerCase();
    
    const numberMatch = lowerMessage.match(/(\d+)/);
    if (numberMatch) {
      return parseInt(numberMatch[1]) - 1;
    }
    
    if (lowerMessage.includes('option 1') || lowerMessage.includes('first')) return 0;
    if (lowerMessage.includes('option 2') || lowerMessage.includes('second')) return 1;
    if (lowerMessage.includes('option 3') || lowerMessage.includes('third')) return 2;
    if (lowerMessage.includes('option 4') || lowerMessage.includes('fourth')) return 3;
    
    return -1;
  }
} 