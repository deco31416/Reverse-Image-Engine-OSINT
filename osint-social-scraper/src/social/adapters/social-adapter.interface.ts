import type { SocialPlatform } from '../types/social-platform.type';
import type { SocialProfile } from '../types/social-profile.type';

export interface SocialAdapter {
  platform: SocialPlatform;
  enabled(): boolean;
  searchByUsername(username: string, limit?: number): Promise<SocialProfile[]>;
  searchByName(query: string, limit?: number): Promise<SocialProfile[]>;
}
