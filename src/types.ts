// Core types for the real estate chatbot
export interface Address {
  raw: string;
  street_number: string;
  street_name: string;
  street_type: string;
  unit: string;
  city: string;
  state: string;
  zip_code: string;
}

export interface ListingUrls {
  listing_id: string;
  view_details_url: string;
  apply_now_url: string;
  schedule_showing_url: string;
  property_website_url: string;
}

export interface UnitDetails {
  beds: number;
  baths: number;
  square_feet: number;
  available: string;
  floorplan_name?: string;
}

export interface RentalTerms {
  rent: number;
  application_fee: number;
  security_deposit: number;
  flex_rent_program: boolean;
}

export interface PetsAllowed {
  allowed: boolean;
  allowed_types: string[];
  weight_limit: number | null;
  size_restrictions: string[];
}

export interface PetPolicy {
  pets_allowed: PetsAllowed;
  pet_rent: number | null;
  pet_deposit: number | null;
}

export interface SpecialOffer {
  flag: boolean;
  text: string | null;
}

export interface Property {
  source: string;
  property_name: string;
  address: Address;
  listing_urls: ListingUrls;
  unit_details: UnitDetails;
  rental_terms: RentalTerms;
  pet_policy: PetPolicy;
  appliances: string[];
  photos: string[];
  special_offer: SpecialOffer;
  utilities_included: string[];
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
  filters?: {
    beds?: number;
    baths?: number;
    rent?: { min?: number; max?: number };
    city?: string;
    pets_allowed?: boolean;
    square_feet?: { min?: number; max?: number };
  };
}

export interface SearchResult {
  properties: Property[];
  query: SearchQuery;
  latency: number;
  cacheHit: boolean;
} 