import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  InstagramSearchDto,
  InstagramProfileData,
  InstagramPostData,
  InstagramCollaborator,
  InstagramCommunityStats,
  InstagramPipelineResponse,
} from '../dto/instagram-search.dto';

// ─── Constants ──────────────────────────────────────────

/** Instagram direct API base URL */
const IG_DIRECT_URL = 'https://www.instagram.com';

/** Instagram Web App ID (well-known constant) */
const IG_APP_ID = '936619743392459';

/** RapidAPI host for Instagram Statistics */
const IG_RAPIDAPI_HOST = 'instagram-statistics-api.p.rapidapi.com';

/** Timeout for API calls */
const READ_TIMEOUT_MS = 30_000;

/** Max retries */
const MAX_RETRIES = 2;

/** Backoff base */
const BACKOFF_BASE_MS = 500;

/**
 * InstagramIntelligenceService — Instagram OSINT 📸
 *
 * Dual-approach Instagram intelligence gathering:
 *
 *  [1] Direct API → instagram.com/api/v1/users/web_profile_info
 *      → Profile completo, posts, colaboradores, tipo de cuenta
 *      → Inspirado en técnica de reverse-engineering (curl_cffi)
 *      → Sin API key, usa X-IG-App-ID header
 *
 *  [2] RapidAPI → instagram-statistics-api.p.rapidapi.com
 *      → Community stats, engagement rate, promedios
 *      → Requiere suscripción RapidAPI
 *
 * Arquitectura determinística — sin LLM. Solo normalización.
 */
@Injectable()
export class InstagramIntelligenceService implements OnModuleInit {
  private readonly logger = new Logger(InstagramIntelligenceService.name);
  private rapidApiKey = '';

  /** Client for Instagram's direct (public) API */
  private igDirectClient!: AxiosInstance;

  /** Client for RapidAPI Instagram Statistics */
  private igRapidApiClient!: AxiosInstance;

  onModuleInit() {
    this.rapidApiKey = process.env.RAPIDAPI_KEY || '';

    if (!this.rapidApiKey) {
      this.logger.warn('⚠️  RAPIDAPI_KEY no configurada — Instagram Stats API no disponible (Direct API sí funciona)');
    } else {
      this.logger.log(`📸 Instagram OSINT initialized (key: ${this.rapidApiKey.substring(0, 8)}...)`);
    }

    // Client for direct Instagram API — uses browser-like headers
    this.igDirectClient = axios.create({
      baseURL: IG_DIRECT_URL,
      timeout: READ_TIMEOUT_MS,
      headers: {
        'X-IG-App-ID': IG_APP_ID,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        Referer: 'https://www.instagram.com/',
      },
    });

    // Client for RapidAPI Instagram Statistics
    this.igRapidApiClient = axios.create({
      baseURL: `https://${IG_RAPIDAPI_HOST}`,
      timeout: READ_TIMEOUT_MS,
      headers: {
        'x-rapidapi-host': IG_RAPIDAPI_HOST,
        'x-rapidapi-key': this.rapidApiKey,
      },
    });
  }

  // ────────────────────────────────────────────────────────
  // PUBLIC API
  // ────────────────────────────────────────────────────────

  /** Direct API siempre disponible (no necesita key) */
  isAvailable(): boolean {
    return true;
  }

  /** RapidAPI necesita suscripción */
  isRapidApiAvailable(): boolean {
    return !!this.rapidApiKey;
  }

  /**
   * Pipeline completo: Direct API + RapidAPI en paralelo
   */
  async executePipeline(dto: InstagramSearchDto): Promise<InstagramPipelineResponse> {
    const t0 = Date.now();
    const igUrl = `https://www.instagram.com/${dto.username}/`;

    this.logger.log(`📸 Instagram OSINT pipeline: "${dto.username}" → ${igUrl}`);

    const response: InstagramPipelineResponse = {
      username: dto.username,
      instagramUrl: igUrl,
      found: false,
      errors: {},
      timing: { totalMs: 0 },
      apiStatus: {
        directApi: dto.fetchProfile !== false ? 'error' : 'skipped',
        rapidApi:
          dto.fetchStats !== false && this.isRapidApiAvailable()
            ? 'error'
            : 'skipped',
      },
    };

    const promises: Promise<void>[] = [];

    // 1. Direct Instagram API — Profile + Posts + Collaborators
    if (dto.fetchProfile !== false) {
      promises.push(this.fetchDirectProfileSafe(dto, response));
    }

    // 2. RapidAPI — Community Stats
    if (dto.fetchStats !== false && this.isRapidApiAvailable()) {
      promises.push(this.fetchCommunityStatsSafe(dto.username, response));
    }

    await Promise.allSettled(promises);

    // Determine if found
    response.found = !!response.profile || !!response.communityStats;
    response.timing.totalMs = Date.now() - t0;

    // Collect all unique collaborators from posts
    if (response.posts && response.posts.length > 0 && dto.detectCollaborators !== false) {
      const collabMap = new Map<string, InstagramCollaborator>();
      for (const post of response.posts) {
        for (const collab of post.collaborators) {
          if (!collabMap.has(collab.username)) {
            collabMap.set(collab.username, collab);
          }
        }
      }
      response.allCollaborators = Array.from(collabMap.values());
    }

    this.logger.log(
      `📸 Instagram pipeline completed: found=${response.found}, ` +
        `posts=${response.posts?.length || 0}, collabs=${response.allCollaborators?.length || 0}, ` +
        `${response.timing.totalMs}ms`,
    );

    return response;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    available: boolean;
    directApiEndpoint: string;
    rapidApiConfigured: boolean;
    rapidApiEndpoint: string | null;
  }> {
    return {
      available: true,
      directApiEndpoint: `${IG_DIRECT_URL}/api/v1/users/web_profile_info/`,
      rapidApiConfigured: this.isRapidApiAvailable(),
      rapidApiEndpoint: this.isRapidApiAvailable()
        ? `https://${IG_RAPIDAPI_HOST}`
        : null,
    };
  }

  // ────────────────────────────────────────────────────────
  // PRIVATE: Safe Wrappers
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
          !isAuthError && (!err?.response || status >= 500 || status === 429);
        if (!isRetryable || attempt === MAX_RETRIES) throw err;
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        this.logger.warn(
          `📸 ${label} attempt ${attempt + 1} failed (${status || 'network'}), retrying in ${delay}ms...`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastError;
  }

  /**
   * Fetch profile via Instagram's direct API (web_profile_info).
   * Reverse-engineered from Instagram's web client.
   * Uses X-IG-App-ID header like the Python InstagramPrivSniffer tool.
   */
  private async fetchDirectProfileSafe(
    dto: InstagramSearchDto,
    out: InstagramPipelineResponse,
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const { data } = await this.withRetry(
        `IG-Direct(${dto.username})`,
        () =>
          this.igDirectClient.get('/api/v1/users/web_profile_info/', {
            params: { username: dto.username },
          }),
      );

      const userData = data?.data?.user;
      if (!userData) {
        throw new Error('User not found in Instagram response');
      }

      // ── Normalize profile ──
      out.profile = this.normalizeProfile(userData);
      out.isPrivate = userData.is_private || false;
      out.apiStatus.directApi = 'ok';

      // ── Extract posts + collaborators ──
      if (dto.fetchPosts !== false) {
        const edges =
          userData?.edge_owner_to_timeline_media?.edges || [];
        out.posts = edges
          .map((edge: any) => this.normalizePost(edge?.node))
          .filter(Boolean) as InstagramPostData[];

        this.logger.debug(
          `📸 Extracted ${out.posts.length} posts for "${dto.username}"` +
            (out.isPrivate ? ' (PRIVATE account — limited data)' : ''),
        );
      }
    } catch (err: any) {
      const status = err?.response?.status || 0;
      let msg =
        err?.response?.data?.message || err.message || 'Unknown error';
      if (status === 404) msg = 'User not found';
      if (status === 429)
        msg = 'Instagram rate limit — try again later';
      this.logger.warn(
        `📸 Instagram direct API error for "${dto.username}": ${msg} (${status})`,
      );
      out.errors.directApi = msg;
      out.apiStatus.directApi = 'error';
    }
    out.timing.directApiMs = Date.now() - t0;
  }

  /**
   * Fetch community stats from RapidAPI Instagram Statistics.
   */
  private async fetchCommunityStatsSafe(
    username: string,
    out: InstagramPipelineResponse,
  ): Promise<void> {
    const t0 = Date.now();
    try {
      const igUrl = `https://www.instagram.com/${username}/`;
      const { data } = await this.withRetry(
        `IG-RapidAPI(${username})`,
        () =>
          this.igRapidApiClient.get('/community', {
            params: { url: igUrl },
          }),
      );

      out.communityStats = this.normalizeCommunityStats(data);
      out.apiStatus.rapidApi = 'ok';
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err.message || 'Unknown error';
      this.logger.warn(
        `📸 Instagram RapidAPI error for "${username}": ${msg}`,
      );
      out.errors.rapidApi = msg;
      out.apiStatus.rapidApi = 'error';
    }
    out.timing.rapidApiMs = Date.now() - t0;
  }

  // ────────────────────────────────────────────────────────
  // PRIVATE: Data Normalization
  // ────────────────────────────────────────────────────────

  /**
   * Normalize Instagram user data from the direct API.
   * Structure: { data: { user: { ... } } }
   */
  private normalizeProfile(userData: any): InstagramProfileData {
    return {
      id: String(userData?.id || userData?.pk || ''),
      username: String(userData?.username || ''),
      fullName: String(userData?.full_name || ''),
      biography: userData?.biography || undefined,
      isPrivate: !!userData?.is_private,
      isVerified: !!userData?.is_verified,
      profilePicUrl: userData?.profile_pic_url || undefined,
      profilePicUrlHd: userData?.profile_pic_url_hd || undefined,
      followerCount:
        userData?.edge_followed_by?.count ||
        userData?.follower_count ||
        0,
      followingCount:
        userData?.edge_follow?.count ||
        userData?.following_count ||
        0,
      postCount:
        userData?.edge_owner_to_timeline_media?.count ||
        userData?.media_count ||
        0,
      externalUrl: userData?.external_url || undefined,
      category:
        userData?.category_name || userData?.category || undefined,
      raw: userData,
    };
  }

  /**
   * Normalize a single Instagram post.
   * Extracts collaborators (tagged users) — the InstagramPrivSniffer technique.
   */
  private normalizePost(node: any): InstagramPostData | null {
    if (!node) return null;

    const shortcode = node.shortcode || '';
    const ownerUsername = node?.owner?.username || '';
    const isVideo = !!node.is_video;

    // Extract collaborators (tagged users)
    const collaborators: InstagramCollaborator[] = [];
    const tagged = node?.edge_media_to_tagged_user?.edges || [];
    for (const edge of tagged) {
      const user = edge?.node?.user;
      if (user?.username) {
        collaborators.push({
          username: user.username,
          profileUrl: `https://www.instagram.com/${user.username}`,
        });
      }
    }

    // Caption (text of the post)
    const captionEdges = node?.edge_media_to_caption?.edges || [];
    const caption = captionEdges[0]?.node?.text || '';

    // Determine media type
    let mediaType: 'image' | 'video' | 'carousel' = 'image';
    if (node?.__typename === 'GraphSidecar') mediaType = 'carousel';
    else if (isVideo) mediaType = 'video';

    return {
      shortcode,
      postUrl: isVideo
        ? `https://www.instagram.com/${ownerUsername}/reel/${shortcode}`
        : `https://www.instagram.com/${ownerUsername}/p/${shortcode}`,
      isVideo,
      displayUrl: node.display_url || undefined,
      videoUrl: isVideo ? node.video_url || undefined : undefined,
      caption: caption || undefined,
      likeCount:
        node?.edge_liked_by?.count ||
        node?.edge_media_preview_like?.count ||
        0,
      commentCount: node?.edge_media_to_comment?.count || 0,
      timestamp: node?.taken_at_timestamp || undefined,
      ownerUsername,
      collaborators,
      mediaType,
    };
  }

  /**
   * Normalize RapidAPI community stats response.
   */
  private normalizeCommunityStats(data: any): InstagramCommunityStats {
    const d = data?.data || data;
    return {
      cid: d?.cid || d?.id || undefined,
      followers: d?.followers || d?.follower_count || undefined,
      following: d?.following || d?.following_count || undefined,
      posts: d?.posts || d?.media_count || undefined,
      engagementRate: d?.engagement_rate || d?.er || undefined,
      avgLikes: d?.avg_likes || undefined,
      avgComments: d?.avg_comments || undefined,
      raw: d,
    };
  }
}
