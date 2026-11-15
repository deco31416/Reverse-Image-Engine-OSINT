import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  CreateSearchDto,
  UpdateSearchDto,
  SearchQueryDto,
  SearchType,
} from './dto';
import {
  SearchResult,
  SearchResultCollection,
  OsintSearchEntity,
  ClusterGroup,
  OsintStats,
  GoogleSearchParams,
} from './interfaces';
import { OsintSearchStore } from './entities';

@Injectable()
export class OsintService {
  private readonly logger = new Logger(OsintService.name);
  private readonly searches: Map<string, OsintSearchStore> = new Map();

  // API Configuration
  private readonly googleApiKey: string;
  private readonly googleCseId: string;
  private readonly twitterBearerToken: string;
  private readonly linkedinClientId: string;
  private readonly linkedinClientSecret: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    // Load API keys from environment
    this.googleApiKey = this.configService.get<string>('GOOGLE_API_KEY') || '';
    this.googleCseId = this.configService.get<string>('GOOGLE_CSE_ID') || '';
    this.twitterBearerToken =
      this.configService.get<string>('TWITTER_BEARER_TOKEN') || '';
    this.linkedinClientId =
      this.configService.get<string>('LINKEDIN_CLIENT_ID') || '';
    this.linkedinClientSecret =
      this.configService.get<string>('LINKEDIN_CLIENT_SECRET') || '';

    this.logger.log('🔍 OSINT Service initialized');
    this.logger.log(
      `Google CSE configured: ${!!this.googleApiKey && !!this.googleCseId}`,
    );
  }

  /**
   * Create new OSINT search
   */
  async createSearch(
    createSearchDto: CreateSearchDto,
  ): Promise<OsintSearchEntity> {
    try {
      this.logger.log(`Creating new search: ${createSearchDto.query}`);

      // Auto-assign cluster letter if not provided
      const clusterLetter =
        createSearchDto.clusterLetter ||
        this.getClusterLetter(createSearchDto.query);

      const search = new OsintSearchStore({
        ...createSearchDto,
        clusterLetter,
      });

      this.searches.set(search.id, search);

      // Perform initial search if requested
      if (createSearchDto.searchType !== SearchType.ALL) {
        const results = await this.performSearch(search.id);
        search.cachedResults = results;
        search.resultCount = results.totalResults;
        search.lastSearched = new Date();
      }

      this.logger.log(`✅ Search created: ${search.id} [${clusterLetter}]`);
      return search.toEntity();
    } catch (error) {
      this.logger.error(`❌ Failed to create search: ${error.message}`);
      throw new HttpException(
        `Failed to create search: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get all searches with optional filtering
   */
  async getAllSearches(query: SearchQueryDto): Promise<{
    searches: OsintSearchEntity[];
    total: number;
    limit: number;
    offset: number;
  }> {
    let searches = Array.from(this.searches.values());

    // Apply filters
    if (query.searchType) {
      searches = searches.filter((s) => s.searchType === query.searchType);
    }
    if (query.category) {
      searches = searches.filter((s) => s.category === query.category);
    }
    if (query.clusterLetter) {
      searches = searches.filter(
        (s) => s.clusterLetter === query.clusterLetter,
      );
    }
    if (query.tag && typeof query.tag === 'string') {
      searches = searches.filter((s) => s.tags.includes(query.tag as string));
    }
    if (query.isActive !== undefined) {
      searches = searches.filter((s) => s.isActive === query.isActive);
    }

    // Sort with default values
    const sortBy = query.sortBy || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';
    searches.sort((a, b) => {
      const aVal = (a as any)[sortBy] || 0;
      const bVal = (b as any)[sortBy] || 0;
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      }
      return aVal < bVal ? 1 : -1;
    });

    const total = searches.length;
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    const paginated = searches.slice(offset, offset + limit);

    return {
      searches: paginated.map((s) => s.toEntity()),
      total,
      limit,
      offset,
    };
  }

  /**
   * Get search by ID
   */
  async getSearchById(id: string): Promise<OsintSearchEntity> {
    const search = this.searches.get(id);
    if (!search) {
      throw new HttpException('Search not found', HttpStatus.NOT_FOUND);
    }
    return search.toEntity();
  }

  /**
   * Update search
   */
  async updateSearch(
    id: string,
    updateSearchDto: UpdateSearchDto,
  ): Promise<OsintSearchEntity> {
    const search = this.searches.get(id);
    if (!search) {
      throw new HttpException('Search not found', HttpStatus.NOT_FOUND);
    }

    this.logger.log(`Updating search: ${id}`);

    // Update fields
    Object.assign(search, updateSearchDto);
    search.updatedAt = new Date();

    // Update cluster letter if query changed
    if (updateSearchDto.query && !updateSearchDto.clusterLetter) {
      search.clusterLetter = this.getClusterLetter(updateSearchDto.query);
    }

    this.searches.set(id, search);

    this.logger.log(`✅ Search updated: ${id}`);
    return search.toEntity();
  }

  /**
   * Delete search
   */
  async deleteSearch(id: string): Promise<{ message: string }> {
    const search = this.searches.get(id);
    if (!search) {
      throw new HttpException('Search not found', HttpStatus.NOT_FOUND);
    }

    this.searches.delete(id);
    this.logger.log(`✅ Search deleted: ${id}`);

    return { message: 'Search deleted successfully' };
  }

  /**
   * Perform search and return results
   */
  async performSearch(searchId: string): Promise<SearchResultCollection> {
    const search = this.searches.get(searchId);
    if (!search) {
      throw new HttpException('Search not found', HttpStatus.NOT_FOUND);
    }

    this.logger.log(
      `Performing search: ${search.query} [${search.searchType}]`,
    );
    const startTime = Date.now();

    let results: SearchResult[] = [];

    try {
      switch (search.searchType) {
        case SearchType.GOOGLE:
          results = await this.searchGoogle(search.query);
          break;
        case SearchType.TWITTER:
          results = await this.searchTwitter(search.query);
          break;
        case SearchType.LINKEDIN:
          results = await this.searchLinkedIn(search.query);
          break;
        case SearchType.FACEBOOK:
          results = await this.searchFacebook(search.query);
          break;
        case SearchType.INSTAGRAM:
          results = await this.searchInstagram(search.query);
          break;
        case SearchType.YOUTUBE:
          results = await this.searchYouTube(search.query);
          break;
        case SearchType.ALL:
          results = await this.searchAll(search.query);
          break;
        default:
          throw new Error(`Unsupported search type: ${search.searchType}`);
      }

      const searchTime = Date.now() - startTime;

      const collection: SearchResultCollection = {
        query: search.query,
        searchType: search.searchType,
        results,
        totalResults: results.length,
        searchTime,
        timestamp: new Date(),
      };

      // Update search entity
      search.cachedResults = collection;
      search.resultCount = results.length;
      search.lastSearched = new Date();
      search.updatedAt = new Date();

      this.logger.log(
        `✅ Search completed: ${results.length} results in ${searchTime}ms`,
      );

      return collection;
    } catch (error) {
      this.logger.error(`❌ Search failed: ${error.message}`);
      throw new HttpException(
        `Search failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get searches organized by alphabetical clusters
   */
  async getClusteredSearches(): Promise<ClusterGroup[]> {
    const clusters: Map<string, OsintSearchStore[]> = new Map();

    // Group searches by cluster letter
    Array.from(this.searches.values()).forEach((search) => {
      const letter = search.clusterLetter || '#';
      if (!clusters.has(letter)) {
        clusters.set(letter, []);
      }
      const clusterArray = clusters.get(letter);
      if (clusterArray) {
        clusterArray.push(search);
      }
    });

    // Convert to array and sort
    const clusterGroups: ClusterGroup[] = Array.from(clusters.entries())
      .map(([letter, searches]) => ({
        letter,
        searches: searches.map((s) => s.toEntity()),
        count: searches.length,
      }))
      .sort((a, b) => a.letter.localeCompare(b.letter));

    return clusterGroups;
  }

  /**
   * Get OSINT statistics
   */
  async getStats(): Promise<OsintStats> {
    const searches = Array.from(this.searches.values());
    const activeSearches = searches.filter((s) => s.isActive);

    const searchesByType: Record<SearchType, number> = {
      [SearchType.GOOGLE]: 0,
      [SearchType.TWITTER]: 0,
      [SearchType.FACEBOOK]: 0,
      [SearchType.INSTAGRAM]: 0,
      [SearchType.LINKEDIN]: 0,
      [SearchType.YOUTUBE]: 0,
      [SearchType.FACE_IMAGE]: 0,
      [SearchType.ALL]: 0,
    };

    const searchesByCategory: Record<string, number> = {};

    searches.forEach((search) => {
      searchesByType[search.searchType]++;
      if (search.category) {
        searchesByCategory[search.category] =
          (searchesByCategory[search.category] || 0) + 1;
      }
    });

    const clusters = await this.getClusteredSearches();

    return {
      totalSearches: searches.length,
      activeSearches: activeSearches.length,
      searchesByType,
      searchesByCategory: searchesByCategory as any,
      clusters,
    };
  }

  // ============================================================================
  // PRIVATE SEARCH IMPLEMENTATION METHODS
  // ============================================================================

  /**
   * Search Google using Custom Search API
   */
  private async searchGoogle(query: string): Promise<SearchResult[]> {
    if (!this.googleApiKey || !this.googleCseId) {
      this.logger.warn('Google API not configured');
      return this.getMockResults(query, SearchType.GOOGLE);
    }

    try {
      const params: GoogleSearchParams = {
        q: query,
        cx: this.googleCseId,
        key: this.googleApiKey,
        num: 10,
      };

      const url = 'https://www.googleapis.com/customsearch/v1';
      const response = await firstValueFrom(
        this.httpService.get(url, { params, timeout: 10000 }),
      );

      if (!response.data.items) {
        return [];
      }

      return response.data.items.map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        source: SearchType.GOOGLE,
        thumbnail: item.pagemap?.cse_thumbnail?.[0]?.src,
        metadata: {
          displayLink: item.displayLink,
          formattedUrl: item.formattedUrl,
        },
      }));
    } catch (error) {
      this.logger.error(`Google search error: ${error.message}`);
      return this.getMockResults(query, SearchType.GOOGLE);
    }
  }

  /**
   * Search Twitter (X)
   */
  private async searchTwitter(query: string): Promise<SearchResult[]> {
    // TODO: Implement Twitter API v2 search
    this.logger.warn('Twitter search not yet implemented');
    return this.getMockResults(query, SearchType.TWITTER);
  }

  /**
   * Search LinkedIn
   */
  private async searchLinkedIn(query: string): Promise<SearchResult[]> {
    // TODO: Implement LinkedIn API search
    this.logger.warn('LinkedIn search not yet implemented');
    return this.getMockResults(query, SearchType.LINKEDIN);
  }

  /**
   * Search Facebook
   */
  private async searchFacebook(query: string): Promise<SearchResult[]> {
    // TODO: Implement Facebook Graph API search
    this.logger.warn('Facebook search not yet implemented');
    return this.getMockResults(query, SearchType.FACEBOOK);
  }

  /**
   * Search Instagram
   */
  private async searchInstagram(query: string): Promise<SearchResult[]> {
    // TODO: Implement Instagram API search
    this.logger.warn('Instagram search not yet implemented');
    return this.getMockResults(query, SearchType.INSTAGRAM);
  }

  /**
   * Search YouTube
   */
  private async searchYouTube(query: string): Promise<SearchResult[]> {
    if (!this.googleApiKey) {
      this.logger.warn('YouTube API not configured');
      return this.getMockResults(query, SearchType.YOUTUBE);
    }

    try {
      const url = 'https://www.googleapis.com/youtube/v3/search';
      const params = {
        q: query,
        key: this.googleApiKey,
        part: 'snippet',
        maxResults: 10,
        type: 'video',
      };

      const response = await firstValueFrom(
        this.httpService.get(url, { params, timeout: 10000 }),
      );

      if (!response.data.items) {
        return [];
      }

      return response.data.items.map((item: any) => ({
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        snippet: item.snippet.description,
        source: SearchType.YOUTUBE,
        thumbnail: item.snippet.thumbnails?.default?.url,
        metadata: {
          channelTitle: item.snippet.channelTitle,
          publishedAt: item.snippet.publishedAt,
        },
        publishedDate: new Date(item.snippet.publishedAt),
      }));
    } catch (error) {
      this.logger.error(`YouTube search error: ${error.message}`);
      return this.getMockResults(query, SearchType.YOUTUBE);
    }
  }

  /**
   * Search all sources
   */
  private async searchAll(query: string): Promise<SearchResult[]> {
    const results = await Promise.all([
      this.searchGoogle(query),
      this.searchTwitter(query),
      this.searchYouTube(query),
      this.searchLinkedIn(query),
    ]);

    return results.flat().sort((a, b) => {
      // Sort by relevance score if available
      return (b.relevanceScore || 0) - (a.relevanceScore || 0);
    });
  }

  /**
   * Get cluster letter from query (first letter, uppercase)
   */
  private getClusterLetter(query: string): string {
    if (!query || query.length === 0) return '#';
    const firstChar = query.trim()[0].toUpperCase();
    return /[A-Z]/.test(firstChar) ? firstChar : '#';
  }

  /**
   * Get mock results for testing/development
   */
  private getMockResults(query: string, source: SearchType): SearchResult[] {
    const mockCount = 5;
    return Array.from({ length: mockCount }, (_, i) => ({
      title: `${source.toUpperCase()} Result ${i + 1} for "${query}"`,
      url: `https://${source}.com/result/${i + 1}`,
      snippet: `This is a mock result snippet for testing the OSINT search functionality. Query: ${query}`,
      source,
      thumbnail: `https://via.placeholder.com/150?text=${source}+${i + 1}`,
      relevanceScore: Math.random() * 100,
      metadata: {
        mock: true,
        resultNumber: i + 1,
      },
    }));
  }
}
