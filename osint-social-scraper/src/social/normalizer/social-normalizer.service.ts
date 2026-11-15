import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { SocialPlatform } from '../types/social-platform.type';
import type { SocialProfile } from '../types/social-profile.type';

@Injectable()
export class SocialNormalizerService {
  profile(input: Partial<SocialProfile> & { platform: SocialPlatform; profileUrl: string }): SocialProfile {
    const capturedAt = input.capturedAt || new Date().toISOString();
    const profile: SocialProfile = {
      platform: input.platform,
      name: input.name,
      username: input.username,
      profileUrl: input.profileUrl,
      avatarUrl: input.avatarUrl,
      bio: input.bio,
      images: input.images || [],
      followers: input.followers,
      following: input.following,
      posts: input.posts,
      links: input.links || [],
      confidence: input.confidence ?? 0.5,
      source: input.source || 'public-web',
      capturedAt,
      evidence: input.evidence || {
        sourceUrl: input.profileUrl,
        hash: this.hash(input.profileUrl),
        capturedAt,
      },
      metadata: input.metadata || {},
    };

    return profile;
  }

  private hash(value: string) {
    return crypto.createHash('sha256').update(value).digest('hex');
  }
}
