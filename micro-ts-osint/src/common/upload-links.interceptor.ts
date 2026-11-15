import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { mergeMap } from 'rxjs/operators';
import { signUploadUrl } from './upload-access';
import { CaseAccessService, CaseActor } from '../osint/services/case-access.service';

@Injectable()
export class UploadLinksInterceptor implements NestInterceptor {
  constructor(private readonly access: CaseAccessService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(mergeMap((value) => request.user ? this.refresh(value, request.user, new Map()) : Promise.resolve(value)));
  }

  private async refresh(value: any, actor: CaseActor, owners: Map<string, Promise<boolean>>, key = ''): Promise<any> {
    // Arbitrary user metadata and query text must never become download grants.
    if (['metadata', 'inputData', 'personalInfo', 'extractedData', 'context'].includes(key)) return value;
    if (typeof value === 'string') {
      if (!['url', 'imageUrl', 'enhancedImageUrl', 'originalImageUrl', 'croppedFaceUrl', 'thumbnailUrl', 'publicUrl', 'secureUrl', 'sourceImageUrl', 'sourceImageUrls'].includes(key)) return value;
      let url: URL;
      try { url = new URL(value, process.env.UPLOAD_PUBLIC_BASE_URL || 'http://uploads.invalid'); } catch { return value; }
      const base = process.env.UPLOAD_PUBLIC_BASE_URL;
      if (!base || url.origin !== new URL(base).origin || !url.pathname.startsWith('/uploads/')) return value;
      if (this.access.isPrivileged(actor) || url.pathname.startsWith('/uploads/datasec/')) return signUploadUrl(value);
      const segments = url.pathname.split('/');
      if (segments[2] === 'face-selections' && segments[3] === this.access.actorId(actor)) return signUploadUrl(value);
      const caseId = segments.find((part) => /^[a-f\d]{24}$/i.test(part));
      if (caseId) {
        if (!owners.has(caseId)) {
          owners.set(caseId, this.access.assertSearch(caseId, actor).then(() => true, () => false));
        }
        if (await owners.get(caseId)) return signUploadUrl(value);
      }
      // Fresh links returned by an upload operation already carry their grant.
      return value;
    }
    if (!value || value instanceof Date || value instanceof StreamableFile || Buffer.isBuffer(value)) return value;
    if (Array.isArray(value)) return Promise.all(value.map((entry) => this.refresh(entry, actor, owners, key)));
    if (typeof value === 'object') {
      const plain = typeof value.toObject === 'function' ? value.toObject() : value;
      if (plain._bsontype) return plain;
      return Object.fromEntries(await Promise.all(Object.entries(plain).map(async ([field, entry]) => [field, await this.refresh(entry, actor, owners, field)])));
    }
    return value;
  }
}
