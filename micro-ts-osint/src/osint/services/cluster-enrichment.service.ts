import { Injectable, Logger } from '@nestjs/common';
import { EvidenceDocument } from '../schemas/evidence.schema';
import { IdentityClusterDocument } from '../schemas/identity-cluster.schema';
import { ClusteringService } from './clustering.service';
import { RegexExtractorService } from './regex-extractor.service';

/**
 * Plataformas conocidas con sus patrones de URL → username
 */
const PLATFORM_PATTERNS: Array<{
  name: string;
  domain: string;
  pattern: RegExp;
  usernameGroup: number;
}> = [
  { name: 'Facebook', domain: 'facebook.com', pattern: /facebook\.com\/(?:profile\.php\?id=(\d+)|([^\/?\s#]+))/, usernameGroup: 2 },
  { name: 'Twitter', domain: 'twitter.com', pattern: /(?:twitter|x)\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Instagram', domain: 'instagram.com', pattern: /instagram\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'LinkedIn', domain: 'linkedin.com', pattern: /linkedin\.com\/in\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'TikTok', domain: 'tiktok.com', pattern: /tiktok\.com\/@?([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'GitHub', domain: 'github.com', pattern: /github\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Medium', domain: 'medium.com', pattern: /medium\.com\/@?([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'YouTube', domain: 'youtube.com', pattern: /youtube\.com\/(?:@|channel\/|c\/|user\/)([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Reddit', domain: 'reddit.com', pattern: /reddit\.com\/u(?:ser)?\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Pinterest', domain: 'pinterest.com', pattern: /pinterest\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Twitch', domain: 'twitch.tv', pattern: /twitch\.tv\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'SoundCloud', domain: 'soundcloud.com', pattern: /soundcloud\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Behance', domain: 'behance.net', pattern: /behance\.net\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Dribbble', domain: 'dribbble.com', pattern: /dribbble\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Flickr', domain: 'flickr.com', pattern: /flickr\.com\/(?:photos|people)\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'DeviantArt', domain: 'deviantart.com', pattern: /deviantart\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'StackOverflow', domain: 'stackoverflow.com', pattern: /stackoverflow\.com\/users\/(\d+)/, usernameGroup: 1 },
  { name: 'Kaggle', domain: 'kaggle.com', pattern: /kaggle\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'TradingView', domain: 'tradingview.com', pattern: /tradingview\.com\/u\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'MQL5', domain: 'mql5.com', pattern: /mql5\.com\/(?:en|es)\/users\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Myfxbook', domain: 'myfxbook.com', pattern: /myfxbook\.com\/members\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'eToro', domain: 'etoro.com', pattern: /etoro\.com\/people\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Telegram', domain: 't.me', pattern: /t\.me\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Quora', domain: 'quora.com', pattern: /quora\.com\/profile\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Goodreads', domain: 'goodreads.com', pattern: /goodreads\.com\/user\/show\/(\d+)/, usernameGroup: 1 },
  { name: 'Pastebin', domain: 'pastebin.com', pattern: /pastebin\.com\/u\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'About.me', domain: 'about.me', pattern: /about\.me\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Linktree', domain: 'linktr.ee', pattern: /linktr\.ee\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Gravatar', domain: 'gravatar.com', pattern: /gravatar\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Binance', domain: 'binance.com', pattern: /binance\.com\/(?:en\/)?feed\/profile\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'MercadoLibre', domain: 'mercadolibre.com', pattern: /mercadolibre\.com(?:\.\w+)?\/perfil\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'GitLab', domain: 'gitlab.com', pattern: /gitlab\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Bitbucket', domain: 'bitbucket.org', pattern: /bitbucket\.org\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'CodePen', domain: 'codepen.io', pattern: /codepen\.io\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'HackerRank', domain: 'hackerrank.com', pattern: /hackerrank\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
  { name: 'Vimeo', domain: 'vimeo.com', pattern: /vimeo\.com\/([^\/?\s#]+)/, usernameGroup: 1 },
];

/**
 * Palabras que NO son usernames (páginas genéricas de plataformas)
 */
const EXCLUDED_USERNAMES = new Set([
  'login', 'signup', 'register', 'about', 'help', 'terms', 'privacy',
  'settings', 'search', 'explore', 'trending', 'home', 'page', 'pages',
  'groups', 'events', 'marketplace', 'watch', 'reels', 'stories',
  'hashtag', 'directory', 'company', 'jobs', 'pulse', 'feed',
  'notifications', 'messages', 'share', 'download', 'app', 'apps',
]);

export interface ClusterEnrichmentResult {
  newAliases: string[];
  newEmails: string[];
  newPhones: string[];
  confirmedProfiles: Array<{ platform: string; url: string; username?: string }>;
  imageUrls: string[];
  totalEvidenceAnalyzed: number;
}

/**
 * Cluster Enrichment Service
 *
 * Después de una búsqueda, analiza TODAS las evidencias para:
 * 1. Descubrir nuevos aliases/usernames en URLs de perfiles
 * 2. Extraer emails y teléfonos nuevos de los snippets
 * 3. Detectar perfiles confirmados en plataformas conocidas
 * 4. Recolectar URLs de imágenes (para futura comparación facial)
 * 5. Actualizar el cluster con toda esta información
 */
@Injectable()
export class ClusterEnrichmentService {
  private readonly logger = new Logger(ClusterEnrichmentService.name);

  constructor(
    private clusteringService: ClusteringService,
    private regexExtractor: RegexExtractorService,
  ) {}

  /**
   * Analiza TODAS las evidencias de una búsqueda y enriquece el cluster
   */
  async enrichClusterFromEvidence(
    cluster: IdentityClusterDocument,
    evidences: EvidenceDocument[],
  ): Promise<ClusterEnrichmentResult> {
    this.logger.log(
      `🔬 Enriching cluster "${cluster.slug}" from ${evidences.length} evidences...`,
    );

    const result: ClusterEnrichmentResult = {
      newAliases: [],
      newEmails: [],
      newPhones: [],
      confirmedProfiles: [],
      imageUrls: [],
      totalEvidenceAnalyzed: evidences.length,
    };

    const knownAliases = new Set(cluster.aliases.map(a => a.toLowerCase()));
    const knownEmails = new Set(cluster.emails.map(e => e.toLowerCase()));
    const knownPhones = new Set(cluster.phones);
    const knownProfileUrls = new Set(
      cluster.confirmedProfiles.map(p => p.url),
    );

    for (const evidence of evidences) {
      // Identity memory is curated. Raw/pending discovery must never promote
      // aliases, contact data or profiles into a confirmed identity cluster.
      if (evidence.validationStatus !== 'valid') continue;

      // 1. Detectar perfiles en URLs
      if (evidence.url) {
        const profile = this.detectProfile(evidence.url);
        if (profile && !knownProfileUrls.has(evidence.url)) {
          result.confirmedProfiles.push({
            platform: profile.platform,
            url: evidence.url,
            username: profile.username,
          });
          knownProfileUrls.add(evidence.url);

          // Agregar username como alias si es nuevo
          if (
            profile.username &&
            !EXCLUDED_USERNAMES.has(profile.username.toLowerCase()) &&
            !knownAliases.has(profile.username.toLowerCase())
          ) {
            result.newAliases.push(profile.username);
            knownAliases.add(profile.username.toLowerCase());
          }
        }
      }

      // 2. Extraer emails/phones de title + summary
      const text = `${evidence.title || ''} ${evidence.summary || ''}`;
      if (text.length > 5) {
        const extracted = this.regexExtractor.extractAll(text);

        for (const email of extracted.emails) {
          if (!knownEmails.has(email.toLowerCase())) {
            result.newEmails.push(email);
            knownEmails.add(email.toLowerCase());
          }
        }
        for (const phone of extracted.phones) {
          const clean = phone.replace(/[\s\-\(\)]/g, '');
          if (!knownPhones.has(clean)) {
            result.newPhones.push(phone);
            knownPhones.add(clean);
          }
        }
      }

      // 3. Extraer emails/phones de extractedData (ya procesado por DuckDuckGo)
      if (evidence.extractedData) {
        for (const email of evidence.extractedData.emails || []) {
          if (!knownEmails.has(email.toLowerCase())) {
            result.newEmails.push(email);
            knownEmails.add(email.toLowerCase());
          }
        }
        for (const phone of evidence.extractedData.phones || []) {
          const clean = phone.replace(/[\s\-\(\)]/g, '');
          if (!knownPhones.has(clean)) {
            result.newPhones.push(phone);
            knownPhones.add(clean);
          }
        }
      }

      // 4. Recolectar imágenes
      if (evidence.imageUrl) {
        result.imageUrls.push(evidence.imageUrl);
      }
      if (evidence.thumbnailUrl) {
        result.imageUrls.push(evidence.thumbnailUrl);
      }
    }

    // 5. Aplicar enriquecimiento al cluster en MongoDB
    await this.applyEnrichment(cluster, result);

    this.logger.log(
      `✅ Cluster enriched: +${result.newAliases.length} aliases, +${result.newEmails.length} emails, ` +
      `+${result.newPhones.length} phones, ${result.confirmedProfiles.length} profiles, ` +
      `${result.imageUrls.length} images`,
    );

    return result;
  }

  /**
   * Detecta si una URL es un perfil de una plataforma conocida
   */
  private detectProfile(
    url: string,
  ): { platform: string; username: string } | null {
    if (!url) return null;

    try {
      const lowerUrl = url.toLowerCase();

      for (const platform of PLATFORM_PATTERNS) {
        if (!lowerUrl.includes(platform.domain)) continue;

        const match = url.match(platform.pattern);
        if (match) {
          const username = match[platform.usernameGroup];
          if (
            username &&
            username.length > 1 &&
            !EXCLUDED_USERNAMES.has(username.toLowerCase())
          ) {
            return { platform: platform.name, username };
          }
        }
      }
    } catch {
      // URL parsing error, skip
    }

    return null;
  }

  /**
   * Aplica el enriquecimiento al cluster en MongoDB
   */
  private async applyEnrichment(
    cluster: IdentityClusterDocument,
    enrichment: ClusterEnrichmentResult,
  ): Promise<void> {
    let changed = false;

    // Agregar nuevos aliases
    for (const alias of enrichment.newAliases) {
      const lower = alias.toLowerCase();
      if (!cluster.aliases.includes(lower)) {
        cluster.aliases.push(lower);
        changed = true;
      }
    }

    // Agregar nuevos emails
    for (const email of enrichment.newEmails) {
      const lower = email.toLowerCase();
      if (!cluster.emails.includes(lower)) {
        cluster.emails.push(lower);
        changed = true;
      }
    }

    // Agregar nuevos teléfonos
    for (const phone of enrichment.newPhones) {
      const clean = phone.replace(/[\s\-\(\)]/g, '');
      if (!cluster.phones.includes(clean)) {
        cluster.phones.push(clean);
        changed = true;
      }
    }

    // Agregar perfiles confirmados
    for (const profile of enrichment.confirmedProfiles) {
      const exists = cluster.confirmedProfiles.some(
        (p) => p.url === profile.url,
      );
      if (!exists) {
        cluster.confirmedProfiles.push({
          platform: profile.platform,
          url: profile.url,
          username: profile.username,
          confirmed: true,
        });

        // Agregar plataforma
        if (!cluster.platforms.includes(profile.platform.toLowerCase())) {
          cluster.platforms.push(profile.platform.toLowerCase());
        }

        changed = true;
      }
    }

    if (changed) {
      cluster.updatedAt = new Date();
      await cluster.save();
      this.logger.log(
        `💾 Cluster "${cluster.slug}" saved with enrichment data`,
      );
    }
  }
}
