import { SearchType, SearchCategory } from '../dto';
import { SearchResultCollection, OsintSearchEntity } from '../interfaces';

/**
 * In-memory storage for OSINT searches
 * For production, replace with database (MongoDB, PostgreSQL, etc.)
 */
export class OsintSearchStore {
  id: string;
  query: string;
  searchType: SearchType;
  category: SearchCategory;
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

  constructor(partial: Partial<OsintSearchStore>) {
    Object.assign(this, partial);
    this.id = partial.id || this.generateId();
    this.createdAt = partial.createdAt || new Date();
    this.updatedAt = partial.updatedAt || new Date();
    this.isActive = partial.isActive !== undefined ? partial.isActive : true;
    this.autoRefresh =
      partial.autoRefresh !== undefined ? partial.autoRefresh : false;
    this.resultCount = partial.resultCount || 0;
    this.tags = partial.tags || [];
  }

  private generateId(): string {
    return `osint_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  toEntity(): OsintSearchEntity {
    return {
      id: this.id,
      query: this.query,
      searchType: this.searchType,
      category: this.category,
      tags: this.tags,
      description: this.description,
      clusterLetter: this.clusterLetter,
      autoRefresh: this.autoRefresh,
      isActive: this.isActive,
      lastSearched: this.lastSearched,
      resultCount: this.resultCount,
      cachedResults: this.cachedResults,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      metadata: this.metadata,
    };
  }
}
