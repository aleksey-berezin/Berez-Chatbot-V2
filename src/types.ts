// Core types for the chatbot
export interface Property {
  id: string;
  name: string;
  address: string;
  beds: number;
  baths: number;
  rent: number;
  available: boolean;
  description?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface SearchQuery {
  type: 'exact' | 'semantic' | 'hybrid';
  query: string;
  filters?: Partial<Property>;
}

export interface SearchResult {
  properties: Property[];
  query: SearchQuery;
  latency: number;
  cacheHit: boolean;
} 