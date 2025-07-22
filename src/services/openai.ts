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

    if (stream) {
      return response;
    } else {
      // Type guard to ensure we have a non-stream response
      if ('choices' in response) {
        return response.choices[0]?.message?.content || '';
      }
      return '';
    }
  }

  // Fast embeddings for semantic search
  async getEmbedding(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: config.openai.embeddingModel,
      input: text
    });

    return response.data[0]?.embedding || [];
  }

  // Analyze query type for hybrid search
  async analyzeQuery(query: string): Promise<'exact' | 'semantic' | 'hybrid'> {
    const messages = [
      {
        role: 'system' as const,
        content: 'Analyze if this query contains specific filters (exact) or is natural language (semantic). Respond with "exact", "semantic", or "hybrid".'
      },
      {
        role: 'user' as const,
        content: query
      }
    ];

    const response = await this.chat(messages);
    const result = response.toString().toLowerCase().trim();
    
    if (result.includes('exact')) return 'exact';
    if (result.includes('semantic')) return 'semantic';
    return 'hybrid';
  }

  // Generate property search filters from query
  async extractFilters(query: string): Promise<Partial<Property>> {
    const messages = [
      {
        role: 'system' as const,
        content: 'Extract property filters from the query. Return only a JSON object with filters like {beds: 2, rent: 2000}.'
      },
      {
        role: 'user' as const,
        content: query
      }
    ];

    const response = await this.chat(messages);
    try {
      return JSON.parse(response.toString());
    } catch {
      return {};
    }
  }
} 