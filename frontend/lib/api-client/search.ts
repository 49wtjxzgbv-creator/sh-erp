import { apiClient } from './http';

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  photoUrl?: string;
}

export interface SearchResults {
  products: SearchResultItem[];
  assemblies: SearchResultItem[];
  customerOrders: SearchResultItem[];
  suppliers: SearchResultItem[];
}

/** GET /search?q= — instant search across products/assemblies/customer orders/suppliers, top 5 per group. */
export function search(q: string): Promise<SearchResults> {
  return apiClient.get<SearchResults>('search', { query: { q } });
}
