import { SearchType, SearchCategory } from '../dto';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source: SearchType;
  thumbnail?: string;
  metadata?: Record<string, any>;
  relevanceScore?: number;
  publishedDate?: Date;
}

export interface SearchResultCollection {
  query: string;
  searchType: SearchType;
  results: SearchResult[];
  totalResults: number;
  searchTime: number; // milliseconds
  timestamp: Date;
}

export interface SocialMediaProfile {
  platform: SearchType;
  username: string;
  displayName: string;
  profileUrl: string;
  avatarUrl?: string;
  bio?: string;
  followers?: number;
  verified?: boolean;
  metadata?: Record<string, any>;
}

export interface GoogleSearchParams {
  q: string;
  cx?: string; // Custom Search Engine ID
  key?: string; // API Key
  num?: number;
  start?: number;
  dateRestrict?: string;
  siteSearch?: string;
  exactTerms?: string;
}

export interface OsintSearchEntity {
  id: string;
  query: string;
  searchType: SearchType;
  category?: SearchCategory;
  tags: string[];
  description?: string;
  clusterLetter?: string;
  autoRefresh: boolean;
  isActive: boolean;
  lastSearched?: Date;
  resultCount: number;
  cachedResults?: SearchResultCollection;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  metadata?: Record<string, any>;
}

export interface ClusterGroup {
  letter: string;
  searches: OsintSearchEntity[];
  count: number;
}

export interface OsintStats {
  totalSearches: number;
  activeSearches: number;
  searchesByType: Record<SearchType, number>;
  searchesByCategory: Record<SearchCategory, number>;
  clusters: ClusterGroup[];
}
