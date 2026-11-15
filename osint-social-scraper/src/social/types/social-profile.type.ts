import type { SocialPlatform } from './social-platform.type';

export type SocialProfile = {
  platform: SocialPlatform;
  name?: string;
  username?: string;
  profileUrl: string;
  avatarUrl?: string;
  bio?: string;
  images: string[];
  followers?: number;
  following?: number;
  posts?: number;
  links: string[];
  confidence: number;
  source: 'api' | 'public-web' | 'scraper' | 'provider';
  capturedAt: string;
  evidence?: {
    sourceUrl: string;
    screenshotUrl?: string;
    hash?: string;
    capturedAt: string;
  };
  metadata: Record<string, unknown>;
};
