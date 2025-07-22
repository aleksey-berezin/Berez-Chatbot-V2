import OpenAI from 'openai';
import { config } from '../config';
import { Property, SearchQuery } from '../types';

export class OpenAIService {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey
    });
  }

  // Fast chat completion
  async chat(messages: any[], stream = false) {
    const response = await this.client.chat.completions.create({
      model: config.openai.model,
      messages,
      stream,
      max_tokens: 500,
      temperature: 0.7
    });

    return stream ? response : response.choices[0]?.message?.content || '';
  }

  // Fast embeddings for semantic search
  async getEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: config.openai.embeddingModel,
      input: text
    });

    return response.data[0]?.embedding || [];
  }

  // Query analysis for hybrid search
  async analyzeQuery(userQuery: string): Promise<SearchQuery> {
    const prompt = `
    Analyze this real estate query and determine the search type:
    Query: "${userQuery}"
    
    Return JSON with:
    - type: "exact", "semantic", or "hybrid"
    - query: the original query
    - filters: any specific criteria (beds, baths, rent range, etc.)
    
    Examples:
    - "2 bedroom apartments under $2000" → exact with filters
    - "luxury apartments downtown" → semantic
    - "pet-friendly places near parks" → hybrid
    `;

    const response = await this.chat([
      { role: 'system', content: 'You are a real estate query analyzer. Return only valid JSON.' },
      { role: 'user', content: prompt }
    ]);

    try {
      return JSON.parse(response);
    } catch {
      // Fallback to semantic search
      return {
        type: 'semantic',
        query: userQuery
      };
    }
  }

  // Generate property recommendations
  async generateRecommendations(properties: Property[], userQuery: string): Promise<string> {
    const propertyList = properties.map(p => 
      `${p.name}: ${p.beds}bd/${p.baths}ba, $${p.rent}/month, ${p.address}`
    ).join('\n');

    const prompt = `
    Based on this query: "${userQuery}"
    
    Here are available properties:
    ${propertyList}
    
    Provide a helpful, concise response recommending the best matches.
    `;

    return await this.chat([
      { role: 'system', content: 'You are a helpful real estate assistant.' },
      { role: 'user', content: prompt }
    ]);
  }
} 