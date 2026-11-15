import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import axios, { AxiosInstance } from 'axios';
import {
  MetaSearchDto,
  MetaFbSearchDto,
  MetaSearchType,
  MetaProfileData,
  MetaPostData,
  MetaPostAttachment,
  MetaIntroCard,
  MetaPhoto,
  MetaSearchResult,
  MetaPipelineResponse,
} from '../dto/meta-search.dto';

// ─── Constants ────────────────────────────────────────────

/** Host principal — facebook-scraper3 (all-in-one: profile+posts+photos+search — SUBSCRIBED ✅) */
const FB_SCRAPER3_HOST = 'facebook-scraper3.p.rapidapi.com';

/** Host fallback — facebook-pages-scraper3 (profile only — SUBSCRIBED ✅) */
const FB_PAGES_SCRAPER3_HOST = 'facebook-pages-scraper3.p.rapidapi.com';

/** Timeout */
const READ_TIMEOUT_MS = 45_000;

/** Max retries */
const MAX_RETRIES = 2;

/** Backoff base */
const BACKOFF_BASE_MS = 600;

/**
 * MetaIntelligenceService v2.0 — Facebook/Meta OSINT 📘
 *
 * 🔄 MIGRADO: de social-media-scrape → facebook-scraper3 (all-in-one)
 *
 * Endpoints disponibles en facebook-scraper3.p.rapidapi.com:
 *
 *  ── Profile ──
 *  [1] /profile/details_url  → Detalles del perfil por URL
 *  [2] /profile/details_id   → Detalles del perfil por ID numérico
 *  [3] /profile/profile_id   → Resolver URL → ID numérico
 *  [4] /profile/posts         → Posts por profile_id
 *  [5] /profile/photos        → Fotos por profile_id
 *
 *  ── Search ──
 *  [6] /search/people         → Buscar personas
 *  [7] /search/pages          → Buscar páginas
 *  [8] /search/posts          → Buscar posts
 *  [9] /search/global         → Búsqueda global
 * [10] /search/locations      → Buscar ubicaciones
 *
 *  ── Pages ──
 * [11] /page/photos           → Fotos de una página por page_id
 *
 * Fallback: facebook-pages-scraper3 para perfil (confirmado funcionando).
 * Arquitectura determinística — sin LLM.
 */
@Injectable()
export class MetaIntelligenceService implements OnModuleInit {
  private readonly logger = new Logger(MetaIntelligenceService.name);
  private rapidApiKey = '';

  /** Cliente principal: facebook-scraper3 (ALL endpoints) */
  private fbClient!: AxiosInstance;

  /** Cliente fallback: facebook-pages-scraper3 (profile only) */
  private fbPagesClient!: AxiosInstance;

  constructor(private readonly httpService: HttpService) {}

  /**
   * Lifecycle hook — reads API key AFTER ConfigModule loads .env.local
   */
  onModuleInit() {
    this.rapidApiKey =
      process.env.RAPIDAPI_KEY ||
      process.env.RAPIDAPI_KEY_FB_SCRAPER3 ||
      '';

    if (!this.rapidApiKey) {
      this.logger.warn('⚠️  RAPIDAPI_KEY no configurada — Meta OSINT no disponible');
    } else {
      this.logger.log(`📘 Meta OSINT v2.0 initialized (key: ${this.rapidApiKey.substring(0, 8)}...)`);
    }

    // Primary: facebook-scraper3 — ALL endpoints
    this.fbClient = axios.create({
      baseURL: `https://${FB_SCRAPER3_HOST}`,
      timeout: READ_TIMEOUT_MS,
      headers: {
        'x-rapidapi-host': FB_SCRAPER3_HOST,
        'x-rapidapi-key': this.rapidApiKey,
      },
    });

    // Fallback: facebook-pages-scraper3 — Profile only (confirmed working)
    this.fbPagesClient = axios.create({
      baseURL: `https://${FB_PAGES_SCRAPER3_HOST}`,
      timeout: READ_TIMEOUT_MS,
      headers: {
        'x-rapidapi-host': FB_PAGES_SCRAPER3_HOST,
        'x-rapidapi-key': this.rapidApiKey,
      },
    });
  }

  // ────────────────────────────────────────────────────────
  // PUBLIC API
  // ────────────────────────────────────────────────────────

  /** ¿El servicio está disponible? (API key configurada) */
  isAvailable(): boolean {
    return !!this.rapidApiKey;
  }

  /**
   * Profile Pipeline: 2-phase
   *   Phase 1: Get profile details (try new API → fallback to old)
   *   Phase 2: In parallel — posts + photos (using profile_id from phase 1)
   */
  async executePipeline(dto: MetaSearchDto): Promise<MetaPipelineResponse> {
    const t0 = Date.now();
    const fbUrl = `https://www.facebook.com/${dto.username}`;

    this.logger.log(`📘 Meta OSINT v2 pipeline: "${dto.username}" → ${fbUrl}`);

    const response: MetaPipelineResponse = {
      username: dto.username,
      facebookUrl: fbUrl,
      found: false,
      errors: {},
      timing: { totalMs: 0 },
      apiStatus: {
        profile: dto.fetchProfile !== false ? 'error' : 'skipped',
        posts: dto.fetchPosts !== false ? 'error' : 'skipped',
        photos: dto.fetchPhotos !== false ? 'error' : 'skipped',
      },
    };

    // ── Phase 1: Get profile (extracts profile_id for phase 2) ──
    let profileId: string | null = null;

    if (dto.fetchProfile !== false) {
      profileId = await this.fetchProfileSafe(dto.username, fbUrl, response);
    }

    // ── Phase 2: Posts + Photos (need profile_id + facebook-scraper3 subscription) ──
    if (profileId) {
      const phase2: Promise<void>[] = [];
      if (dto.fetchPosts !== false) {
        phase2.push(this.fetchPostsSafe(profileId, dto.username, response));
      }
      if (dto.fetchPhotos !== false) {
        phase2.push(this.fetchPhotosSafe(profileId, dto.username, response));
      }
      if (phase2.length > 0) {
        await Promise.allSettled(phase2);
      }
    } else if (!profileId && dto.fetchProfile !== false) {
      // No profile_id — posts/photos endpoints need it (facebook-scraper3)
      // BUT: photos may already be available from profile response (facebook-pages-scraper3)
      if (dto.fetchPosts !== false && response.apiStatus.posts !== 'ok') {
        response.apiStatus.posts = 'skipped';
        response.errors.posts = 'Skipped — no profile_id (subscribe to facebook-scraper3 for posts)';
      }
      if (dto.fetchPhotos !== false && response.apiStatus.photos !== 'ok') {
        // If profile already has photos, use them
        if (response.profile?.photos && response.profile.photos.length > 0) {
          response.photos = response.profile.photos;
          response.apiStatus.photos = 'ok';
          this.logger.debug(`📘 Photos: ${response.photos.length} from profile response`);
        } else {
          response.apiStatus.photos = 'skipped';
          response.errors.photos = 'Skipped — no profile_id (subscribe to facebook-scraper3 for more photos)';
        }
      }
    }

    // ── Determine found ──
    response.found =
      !!response.profile ||
      (!!response.posts && response.posts.length > 0) ||
      (!!response.photos && response.photos.length > 0);

    // ── Legacy compat: map photos timing to pageDetails ──
    response.timing.pageDetailsMs = response.timing.photosMs;
    response.apiStatus.pageDetails = response.apiStatus.photos;

    response.timing.totalMs = Date.now() - t0;

    this.logger.log(
      `📘 Meta v2 pipeline: found=${response.found}, ` +
        `profile=${response.apiStatus.profile}, posts=${response.apiStatus.posts}, ` +
        `photos=${response.apiStatus.photos}, ${response.timing.totalMs}ms`,
    );

    return response;
  }

  /**
   * Facebook Search: people, pages, posts, global, locations
   */
  async executeSearch(dto: MetaFbSearchDto): Promise<MetaPipelineResponse> {
    const t0 = Date.now();
    const searchType = dto.searchType || MetaSearchType.GLOBAL;

    this.logger.log(`📘 Meta search: type=${searchType}, query="${dto.query}"`);

    const response: MetaPipelineResponse = {
      username: dto.query,
      facebookUrl: '',
      found: false,
      errors: {},
      timing: { totalMs: 0 },
      apiStatus: {
        search: 'error',
      },
    };

    const ts = Date.now();
    try {
      const { data } = await this.withRetry(
        `Search(${searchType}:${dto.query})`,
        () =>
          this.fbClient.get(`/search/${searchType}`, {
            params: { query: dto.query },
          }),
      );

      const results = Array.isArray(data)
        ? data
        : data?.data || data?.results || [];
      response.search = {
        type: searchType,
        query: dto.query,
        results: Array.isArray(results) ? results : [results],
        count: Array.isArray(results) ? results.length : 1,
        raw: data,
      };
      response.found = response.search.count > 0;
      response.apiStatus.search = 'ok';
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err.message || 'Unknown error';
      this.logger.warn(`📘 Search error (${searchType}): ${msg}`);
      response.errors.search = msg;
    }
    response.timing.searchMs = Date.now() - ts;
    response.timing.totalMs = Date.now() - t0;

    return response;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    available: boolean;
    apiKeyConfigured: boolean;
    primaryEndpoint: string;
    fallbackEndpoint: string;
    endpoints: Record<string, string>;
  }> {
    return {
      available: this.isAvailable(),
      apiKeyConfigured: !!this.rapidApiKey,
      primaryEndpoint: `https://${FB_SCRAPER3_HOST}`,
      fallbackEndpoint: `https://${FB_PAGES_SCRAPER3_HOST}`,
      endpoints: {
        profile: '/profile/details_url',
        profileById: '/profile/details_id',
        resolveId: '/profile/profile_id',
        posts: '/profile/posts',
        photos: '/profile/photos',
        searchPeople: '/search/people',
        searchPages: '/search/pages',
        searchPosts: '/search/posts',
        searchGlobal: '/search/global',
        searchLocations: '/search/locations',
        pagePhotos: '/page/photos',
      },
    };
  }

  // ────────────────────────────────────────────────────────
  // PRIVATE: Retry wrapper
  // ────────────────────────────────────────────────────────

  private async withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const status = err?.response?.status || 0;
        const isAuthError = status === 401 || status === 403;
        const isRetryable =
          !isAuthError &&
          (!err?.response || status >= 500 || status === 429);
        if (!isRetryable || attempt === MAX_RETRIES) throw err;
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        this.logger.warn(
          `📘 ${label} attempt ${attempt + 1} failed (${status || 'network'}), retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  // ────────────────────────────────────────────────────────
  // PRIVATE: Safe fetch wrappers
  // ────────────────────────────────────────────────────────

  /**
   * Fetch profile: try facebook-scraper3 FIRST (richer data), fallback to facebook-pages-scraper3.
   * Returns the profile_id if found (for subsequent posts/photos requests).
   */
  private async fetchProfileSafe(
    username: string,
    fbUrl: string,
    out: MetaPipelineResponse,
  ): Promise<string | null> {
    const t0 = Date.now();

    // ── Strategy: facebook-scraper3 FIRST (richer data: name, profile_id, verified, about_public) ──
    // Then facebook-pages-scraper3 as fallback
    try {
      const { data } = await this.withRetry(
        `Profile(${username})`,
        () =>
          this.fbClient.get('/profile/details_url', {
            params: { url: fbUrl },
          }),
      );

      // Guard: empty response
      if (!data || (Array.isArray(data) && data.length === 0)) {
        throw new Error('Empty response — user not found or private');
      }

      // Guard: "not subscribed" message
      if (data?.message?.toLowerCase?.()?.includes?.('not subscribed')) {
        throw new Error(`API: ${data.message}`);
      }

      out.profile = this.normalizeProfile(data);
      out.apiStatus.profile = 'ok';
      out.timing.profileMs = Date.now() - t0;
      this.logger.debug(
        `📘 Profile via facebook-scraper3: id=${out.profile?.id}, name="${out.profile?.name}", ` +
          `verified=${out.profile?.verified}, introCards=${out.profile?.introCards?.length}`,
      );
      return out.profile?.id || null;
    } catch (primaryErr: any) {
      this.logger.warn(
        `📘 Primary (facebook-scraper3) failed (${primaryErr?.response?.status || primaryErr.message}), trying pages-scraper3...`,
      );

      // ── Fallback: facebook-pages-scraper3 (profile + photos) ──
      try {
        const { data } = await this.withRetry(
          `Profile-fallback(${username})`,
          () =>
            this.fbPagesClient.get('/get-profile-home-page-details', {
              params: { urlSupplier: fbUrl, url: fbUrl },
            }),
        );

        // Guard: empty array
        if (!data || (Array.isArray(data) && data.length === 0)) {
          throw new Error('Empty response — user not found or private');
        }

        // Guard: "not subscribed"
        if (data?.message?.toLowerCase?.()?.includes?.('not subscribed')) {
          throw new Error(`pages-scraper3: ${data.message}`);
        }

        out.profile = this.normalizeProfile(data);
        out.apiStatus.profile = 'ok';
        out.timing.profileMs = Date.now() - t0;
        this.logger.debug(
          `📘 Profile via pages-scraper3: id=${out.profile?.id}, ` +
            `introCards=${out.profile?.introCards?.length}, photos=${out.profile?.photos?.length}`,
        );
        return out.profile?.id || null;
      } catch (fallbackErr: any) {
        const msg =
          fallbackErr?.response?.data?.message ||
          fallbackErr.message ||
          'Unknown error';
        this.logger.warn(`📘 Profile error for "${username}": ${msg}`);
        out.errors.profile = msg;
        out.apiStatus.profile = 'error';
        out.timing.profileMs = Date.now() - t0;
        return null;
      }
    }
  }

  /**
   * Fetch posts via facebook-scraper3 /profile/posts
   */
  private async fetchPostsSafe(
    profileId: string,
    username: string,
    out: MetaPipelineResponse,
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const { data } = await this.withRetry(`Posts(${username})`, () =>
        this.fbClient.get('/profile/posts', {
          params: { profile_id: profileId },
        }),
      );
      out.posts = this.normalizePosts(data);
      out.apiStatus.posts = 'ok';
      this.logger.debug(`📘 Posts: ${out.posts.length} posts for "${username}"`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err.message || 'Unknown error';
      this.logger.warn(`📘 Posts error for "${username}": ${msg}`);
      out.errors.posts = msg;
      out.apiStatus.posts = 'error';
    }
    out.timing.postsMs = Date.now() - t0;
  }

  /**
   * Fetch photos via facebook-scraper3 /profile/photos
   */
  private async fetchPhotosSafe(
    profileId: string,
    username: string,
    out: MetaPipelineResponse,
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const { data } = await this.withRetry(`Photos(${username})`, () =>
        this.fbClient.get('/profile/photos', {
          params: { profile_id: profileId },
        }),
      );
      out.photos = this.normalizePhotos(data);
      out.apiStatus.photos = 'ok';
      this.logger.debug(`📘 Photos: ${out.photos.length} photos for "${username}"`);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err.message || 'Unknown error';
      this.logger.warn(`📘 Photos error for "${username}": ${msg}`);
      out.errors.photos = msg;
      out.apiStatus.photos = 'error';
    }
    out.timing.photosMs = Date.now() - t0;
  }

  // ────────────────────────────────────────────────────────
  // PRIVATE: Data Normalization
  // ────────────────────────────────────────────────────────

  /**
   * Normalize profile data.
   * Handles facebook-scraper3, facebook-pages-scraper3, and GraphQL formats.
   */
  private normalizeProfile(raw: any): MetaProfileData {
    // Unwrap nested data
    let d = raw;
    if (d?.data?.data) d = d.data.data;
    else if (d?.data) d = d.data;

    // ── Detect format ──
    // Format A: facebook-scraper3 → { profile: { name, profile_id, about_public, image, ... } }
    const isScraper3 = !!d?.profile?.profile_id || !!d?.profile?.name;
    // Format B: facebook-pages-scraper3 → { INTRO_CARDS: {...}, PHOTOS: [...] }
    const isFlatFormat = !isScraper3 && d?.INTRO_CARDS && !d?.id && !d?.name;

    // Intro cards
    const introCards: MetaIntroCard[] = [];
    // Photos from profile
    const photos: MetaPhoto[] = [];

    let profileId = '';
    let name = '';
    let typeName = 'Unknown';
    let profilePic = '';
    let coverPhoto = '';
    let gender: string | undefined;
    let verified: boolean | undefined;
    let intro: string | undefined;
    let url: string | undefined;

    if (isScraper3) {
      // ── facebook-scraper3 format ──
      const p = d.profile;
      profileId = String(p.profile_id || '');
      name = String(p.name || '');
      typeName = String(p.influencer_category || 'Profile');
      profilePic = String(p.image || '');
      coverPhoto = String(p.cover_image || '');
      gender = p.gender ? String(p.gender) : undefined;
      verified = p.verified === true ? true : undefined;
      intro = p.intro ? String(p.intro) : undefined;
      url = p.url ? String(p.url) : undefined;

      // about_public → introCards
      if (Array.isArray(p.about_public)) {
        for (const item of p.about_public) {
          const text = String(item?.text || '');
          const extUrl = item?.external_url || null;
          if (text) {
            introCards.push({
              label: extUrl ? 'Link' : 'Info',
              value: text,
              externalUrl: extUrl || undefined,
            });
          }
        }
      }
    } else if (isFlatFormat) {
      // ── facebook-pages-scraper3 format ──
      const ic = d.INTRO_CARDS;
      profileId = String(ic?.PAGE_ID || '');
      typeName = String(ic?.INTRO_CARD_INFLUENCER_CATEGORY || 'Profile');

      const skipKeys = ['PAGE_ID'];
      for (const [key, val] of Object.entries(ic || {})) {
        if (skipKeys.includes(key) || !val) continue;
        const label = key
          .replace(/^INTRO_CARD_/, '')
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace(/\b\w/g, (c: string) => c.toUpperCase());
        introCards.push({ label, value: String(val) });
      }

      if (Array.isArray(d?.PHOTOS)) {
        for (const p of d.PHOTOS) {
          if (p?.uri || p?.thumb) {
            photos.push({
              id: String(p.id || ''),
              uri: String(p.uri || p.thumb || ''),
              width: p.width || undefined,
              height: p.height || undefined,
            });
          }
        }
      }

      profilePic = d?.PHOTOS?.[0]?.thumb || d?.PHOTOS?.[0]?.uri || '';
    } else {
      // ── GraphQL / unknown format ──
      profileId = String(d?.id || d?.user_id || d?.profile_id || '');
      name = String(d?.name || '');
      typeName = String(d?.__typename || d?.type_name || 'Unknown');
      profilePic =
        d?.profile_picture?.uri ||
        d?.profilePicture?.uri ||
        d?.profile_pic_large?.uri ||
        '';
      coverPhoto =
        d?.cover_photo?.photo?.image?.uri ||
        d?.coverPhoto?.photo?.image?.uri ||
        d?.cover_photo?.uri ||
        '';
      gender = d?.gender ? String(d.gender) : undefined;

      // GraphQL intro cards
      const introSections =
        d?.INTRO_CARD_COLLECTIONS?.nodes ||
        d?.intro_card_collections?.nodes ||
        [];
      for (const section of introSections) {
        const items = section?.intro_cards?.nodes || [];
        for (const card of items) {
          const label = card?.title?.text || card?.title || '';
          const value =
            card?.subtitle?.text || card?.subtitle || card?.icon_name || '';
          if (label || value) {
            introCards.push({ label: String(label), value: String(value) });
          }
        }
      }

      // GraphQL photos
      const photoNodes =
        d?.PHOTOS?.edges ||
        d?.photos?.edges ||
        d?.profilePhotoAlbum?.edges ||
        [];
      for (const edge of photoNodes) {
        const node = edge?.node || edge;
        const img = node?.image || node;
        if (img?.uri || img?.url) {
          photos.push({
            id: String(node?.id || ''),
            uri: String(img.uri || img.url || ''),
            width: img.width || undefined,
            height: img.height || undefined,
          });
        }
      }
    }

    return {
      id: profileId,
      typeName,
      name,
      gender,
      verified,
      intro,
      url,
      profilePicture: profilePic || undefined,
      coverPhoto: coverPhoto || undefined,
      introCards,
      photos,
      raw: d,
    };
  }

  /**
   * Normalize posts array from facebook-scraper3.
   */
  private normalizePosts(raw: any): MetaPostData[] {
    let postsArray: any[] = [];
    if (raw?.results && Array.isArray(raw.results)) postsArray = raw.results;
    else if (raw?.data?.data?.posts) postsArray = raw.data.data.posts;
    else if (raw?.data?.posts) postsArray = raw.data.posts;
    else if (raw?.posts) postsArray = raw.posts;
    else if (Array.isArray(raw?.data)) postsArray = raw.data;
    else if (Array.isArray(raw)) postsArray = raw;

    if (!Array.isArray(postsArray)) {
      this.logger.warn('📘 Posts: response no contiene array de posts');
      return [];
    }

    return postsArray
      .map((p: any) => this.normalizePost(p))
      .filter(Boolean) as MetaPostData[];
  }

  /**
   * Normalize a single post.
   */
  private normalizePost(post: any): MetaPostData | null {
    if (!post) return null;

    const details = post?.details || {};
    const reactions = post?.reactions || {};
    const values = post?.values || {};

    const text =
      values?.text ||
      post?.message ||
      post?.message_rich ||
      post?.text ||
      details?.message ||
      '';

    const attachments: MetaPostAttachment[] = [];

    // ── Handle facebook-scraper3 image/video fields ──
    if (post?.image) {
      attachments.push({ type: 'photo', uri: String(post.image) });
    }
    if (post?.video) {
      attachments.push({
        type: 'video',
        uri: String(post.video),
        thumbnail: post.video_thumbnail || undefined,
      });
    }
    if (post?.album_preview && Array.isArray(post.album_preview)) {
      for (const img of post.album_preview) {
        if (img?.uri || img?.url) {
          attachments.push({ type: 'photo', uri: String(img.uri || img.url) });
        }
      }
    }

    // ── Handle legacy attachments array ──
    const rawAtts = post?.attachments || [];
    for (const att of Array.isArray(rawAtts) ? rawAtts : []) {
      if (att?.type === 'Photo' && att?.photo_image) {
        attachments.push({
          type: 'photo',
          uri: att.photo_image.uri || '',
          width: att.photo_image.width,
          height: att.photo_image.height,
        });
      } else if (att?.type === 'Video') {
        attachments.push({
          type: 'video',
          uri: att?.video_url || att?.uri || '',
        });
      } else if (att?.uri || att?.url) {
        attachments.push({
          type: String(att.type || 'unknown').toLowerCase(),
          uri: att.uri || att.url || '',
        });
      }
    }

    // Reactions: facebook-scraper3 returns { like: N, love: N, ... } or reactions_count
    const reactionCount = Number(
      post?.reactions_count ||
      reactions?.total_reaction_count ||
      post?.reaction_count ||
      0,
    );

    // Timestamp → date string
    const timestamp = post?.timestamp || details?.creation_time;
    const createdAt = timestamp
      ? new Date(Number(timestamp) * 1000).toISOString()
      : undefined;

    return {
      postId: String(
        details?.post_id || post?.post_id || post?.id || '',
      ),
      text: text ? String(text) : undefined,
      url: post?.url || undefined,
      createdAt,
      commentsCount: Number(
        details?.comments_count || post?.comments_count || 0,
      ),
      shareCount: Number(
        details?.share_count || post?.reshare_count || post?.share_count || 0,
      ),
      reactionCount,
      reactions: typeof reactions === 'object' && !Array.isArray(reactions) && Object.keys(reactions).length > 0
        ? reactions
        : undefined,
      attachments,
    };
  }

  /**
   * Normalize photos array from facebook-scraper3 /profile/photos.
   */
  private normalizePhotos(raw: any): MetaPhoto[] {
    let photosArray: any[] = [];
    if (raw?.results && Array.isArray(raw.results)) photosArray = raw.results;
    else if (Array.isArray(raw?.data)) photosArray = raw.data;
    else if (Array.isArray(raw)) photosArray = raw;
    else if (raw?.photos) photosArray = raw.photos;
    else if (raw?.data?.photos) photosArray = raw.data.photos;

    if (!Array.isArray(photosArray)) {
      this.logger.warn('📘 Photos: response no contiene array de fotos');
      return [];
    }

    return photosArray
      .map((p: any) => {
        const img = p?.image || p;
        return {
          id: String(p?.id || p?.photo_id || ''),
          uri: String(
            img?.uri || img?.url || p?.source || p?.url || '',
          ),
          width: img?.width || p?.width || undefined,
          height: img?.height || p?.height || undefined,
        };
      })
      .filter((p: MetaPhoto) => p.uri);
  }
}
