import { Module } from '@nestjs/common';
import { CacheModule } from '../cache/cache.module';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { DatabaseModule } from '../database/database.module';
import { SocialNormalizerService } from './normalizer/social-normalizer.service';
import { GithubAdapter } from './adapters/github/github.adapter';
import { InstagramAdapter } from './adapters/instagram/instagram.adapter';
import { FacebookAdapter } from './adapters/facebook/facebook.adapter';
import { TiktokAdapter } from './adapters/tiktok/tiktok.adapter';
import { XAdapter } from './adapters/x/x.adapter';
import { RedditAdapter } from './adapters/reddit/reddit.adapter';
import { PinterestAdapter } from './adapters/pinterest/pinterest.adapter';
import { MediumAdapter } from './adapters/medium/medium.adapter';
import { YoutubeAdapter } from './adapters/youtube/youtube.adapter';
import { TelegramAdapter } from './adapters/telegram/telegram.adapter';
import { DiscordAdapter } from './adapters/discord/discord.adapter';
import { ThreadsAdapter } from './adapters/threads/threads.adapter';
import { MastodonAdapter } from './adapters/mastodon/mastodon.adapter';
import { BlueskyAdapter } from './adapters/bluesky/bluesky.adapter';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';
import { StorageModule } from '../storage/storage.module';
import { ImageFingerprintService } from './visual/image-fingerprint.service';

@Module({
  imports: [CacheModule, DatabaseModule, StorageModule],
  controllers: [SocialController],
  providers: [
    InternalApiKeyGuard,
    SocialService,
    SocialNormalizerService,
    GithubAdapter,
    InstagramAdapter,
    FacebookAdapter,
    TiktokAdapter,
    XAdapter,
    RedditAdapter,
    PinterestAdapter,
    MediumAdapter,
    YoutubeAdapter,
    TelegramAdapter,
    DiscordAdapter,
    ThreadsAdapter,
    MastodonAdapter,
    BlueskyAdapter,
    ImageFingerprintService,
  ],
  exports: [SocialService],
})
export class SocialModule {}
