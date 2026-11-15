import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthService } from '../auth/auth.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { LocalJobQueue } from '../common/local-job-queue';
import { signUploadUrl, verifyUploadUrl } from '../common/upload-access';
import { SecurityValidationService } from '../osint/services/security-validation.service';
import { PdfReportGeneratorService } from '../osint/services/pdf-report-generator.service';
import * as puppeteer from 'puppeteer';

jest.mock('puppeteer', () => ({ launch: jest.fn() }));
const config = (values: Record<string, string> = {}) => ({ get: (key: string) => values[key] });

describe('Security regressions', () => {
  it.each([
    '127.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]',
    '[0:0:0:0:0:ffff:a00:1]', '[fe90::1]', '[fc00::1]', '[2002:7f00:1::1]',
  ])('rejects non-public destinations in every supported notation: %s', async (host) => {
    const service = new SecurityValidationService(config({ NODE_ENV: 'production' }) as any);
    await expect(service.fetchPublicUrl(`http://${host}/image`)).rejects.toThrow();
  });

  it('allows public literal IPv4 and IPv6 without DNS rebinding', async () => {
    const service = new SecurityValidationService(config() as any);
    await expect(service.validatePublicUrl('https://8.8.8.8/image')).resolves.toBe('https://8.8.8.8/image');
    await expect(service.validatePublicUrl('https://[2606:4700:4700::1111]/image')).resolves.toBeDefined();
  });

  it('requires signed, unexpired, unmodified upload links', () => {
    const signed = signUploadUrl('https://images.example/uploads/case/image.jpg', 'https://images.example');
    expect(verifyUploadUrl(signed)).toBe(true);
    expect(verifyUploadUrl('https://images.example/uploads/case/image.jpg')).toBe(false);
    expect(verifyUploadUrl(signed.replace('image.jpg', 'another.jpg'))).toBe(false);
    expect(verifyUploadUrl(signed.replace(/expires=\d+/, 'expires=1000000000'))).toBe(false);
  });

  it('denies writes to viewers while allowing their reads', () => {
    const guard = new RolesGuard({ getAllAndOverride: () => undefined } as any);
    const context = (method: string) => ({ getHandler: () => null, getClass: () => null,
      switchToHttp: () => ({ getRequest: () => ({ method, user: { role: 'viewer' } }) }) });
    expect(guard.canActivate(context('GET') as any)).toBe(true);
    expect(() => guard.canActivate(context('PATCH') as any)).toThrow(ForbiddenException);
  });

  it('uses the current account role and rejects revoked and disabled sessions', async () => {
    const user: any = { _id: new Types.ObjectId(), status: 'active', role: 'viewer', sessionVersion: 2 };
    const model = { findById: () => ({ exec: async () => user }) };
    const auth = new AuthService({} as any, config() as any, model as any, {} as any, null);
    const payload = { sub: String(user._id), ver: 2, role: 'admin', iat: Math.floor(Date.now() / 1000) };
    await expect(auth.validateToken(payload)).resolves.toMatchObject({ role: 'viewer' });
    await expect(auth.validateToken({ ...payload, ver: 1 })).rejects.toThrow(UnauthorizedException);
    user.status = 'disabled';
    await expect(auth.validateToken(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('keeps throttling attempts when Redis is unavailable', async () => {
    const redis = { incr: jest.fn().mockRejectedValue(new Error('offline')) };
    const auth = new AuthService({} as any, config() as any, {} as any, {} as any, redis as any);
    for (let i = 0; i < 3; i++) await (auth as any).assertAuthRateLimit('test', 'account', 3, 900);
    await expect((auth as any).assertAuthRateLimit('test', 'account', 3, 900)).rejects.toThrow('Demasiados intentos');
  });

  it('does not reveal whether a recovery account exists', async () => {
    let user: any = { _id: new Types.ObjectId(), status: 'active', email: 'fixture@example.test' };
    const auth = new AuthService({} as any, config() as any,
      { findOne: () => ({ exec: async () => user }) } as any,
      { create: jest.fn().mockResolvedValue({}) } as any, null);
    jest.spyOn(auth as any, 'sendRecoveryEmail').mockResolvedValue(undefined);
    const known = await auth.forgotPassword({ identifier: 'known' });
    user = null;
    const unknown = await auth.forgotPassword({ identifier: 'unknown' });
    expect(known).toEqual(unknown);
    expect(known).not.toHaveProperty('resetUrl');
    expect(known).not.toHaveProperty('delivery');
  });

  it('bounds fallback concurrency and keeps completion state', async () => {
    const queue = new LocalJobQueue(1);
    let release!: () => void;
    const second = jest.fn().mockResolvedValue(undefined);
    queue.enqueue('first', () => new Promise<void>((resolve) => { release = resolve; }));
    queue.enqueue('second', second);
    await Promise.resolve();
    expect(queue.stats()).toMatchObject({ active: 1, queued: 1 });
    expect(second).not.toHaveBeenCalled();
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(queue.get('first')?.status).toBe('completed');
    expect(queue.get('second')?.status).toBe('completed');
    queue.close();
  });

  it('renders report input as text and disables scripts and all external requests', async () => {
    const page = { setJavaScriptEnabled: jest.fn(), setRequestInterception: jest.fn(), on: jest.fn(),
      setContent: jest.fn(), pdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const browser = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn() };
    (puppeteer.launch as jest.Mock).mockResolvedValue(browser);
    const report = new PdfReportGeneratorService({ generateReport: async () => '<script>alert(1)</script><img src="http://127.0.0.1/">' } as any);
    await report.generatePdf('fixture');
    expect(page.setContent.mock.calls[0][0]).not.toContain('<script>');
    expect(page.setContent.mock.calls[0][0]).toContain('&lt;script&gt;');
    expect(page.setJavaScriptEnabled).toHaveBeenCalledWith(false);
    const abort = jest.fn().mockResolvedValue(undefined);
    page.on.mock.calls[0][1]({ abort });
    expect(abort).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
});
