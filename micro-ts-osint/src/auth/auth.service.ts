import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Redis } from 'ioredis';
import { randomBytes, scrypt as nodeScrypt, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import * as nodemailer from 'nodemailer';
import { LoginDto, AuthResponseDto } from './dto/login.dto';
import { ChangePasswordDto, CreateUserDto, ForgotPasswordDto, ResetPasswordDto } from './dto/access.dto';
import { PasswordResetToken, PasswordResetTokenDocument } from './schemas/password-reset-token.schema';
import { User, UserDocument, UserRole } from './schemas/user.schema';

const scrypt = promisify(nodeScrypt);
const HASH_KEY_LENGTH = 64;

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly localAuthLimits = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(PasswordResetToken.name)
    private resetTokenModel: Model<PasswordResetTokenDocument>,
    @Inject('REDIS_CLIENT') private redis: Redis | null,
  ) {}

  async onModuleInit() {
    await this.ensureInitialOwner();
    await this.ensureDemoUsers();
  }

  async login(loginDto: LoginDto, requestedIp?: string): Promise<AuthResponseDto> {
    const identifier = this.normalizeIdentifier(loginDto.username);
    this.logger.log(`Login attempt for user: ${identifier}`);
    await this.assertAuthRateLimit('login', `${requestedIp || 'unknown'}:${identifier}`, 8, 900);
    await this.assertAuthRateLimit('login-ip', requestedIp || 'unknown', 40, 900);
    await this.assertAuthRateLimit('login-account', identifier, 15, 900);

    const user = await this.findUserByIdentifier(identifier);
    if (!user || user.status !== 'active') {
      this.logger.warn(`Invalid credentials for user: ${identifier}`);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    const validPassword = await this.verifyPassword(loginDto.password, user.passwordHash);
    if (!validPassword) {
      this.logger.warn(`Invalid credentials for user: ${identifier}`);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    user.lastLoginAt = new Date();
    await user.save();

    return this.buildAuthResponse(user);
  }

  async createUser(dto: CreateUserDto): Promise<any> {
    const email = this.normalizeIdentifier(dto.email);
    const username = this.normalizeIdentifier(dto.username);
    const exists = await this.userModel.exists({ $or: [{ email }, { username }] });
    if (exists) {
      throw new ConflictException('Ya existe un usuario con ese email o username');
    }

    const user = await this.userModel.create({
      email,
      username,
      displayName: dto.displayName?.trim() || username,
      passwordHash: await this.hashPassword(dto.password),
      role: dto.role || 'analyst',
      status: 'active',
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      metadata: { source: 'dashboard' },
    });

    this.logger.log(`User created: ${user.username} (${user.role})`);
    return this.publicUser(user);
  }

  async listUsers() {
    const users = await this.userModel.find().sort({ createdAt: -1 }).limit(100).exec();
    return users.map((user) => this.publicUser(user));
  }

  async me(user: any) {
    if (!user?.userId || user.authType === 'api-key') {
      return {
        userId: user?.userId || 'service-gateway',
        username: user?.username || 'service-gateway',
        email: user?.email,
        role: user?.role || 'admin',
        status: 'active',
        authType: user?.authType || 'jwt',
      };
    }

    const found = await this.userModel.findById(user.userId).exec();
    if (!found) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return this.publicUser(found);
  }

  async forgotPassword(dto: ForgotPasswordDto, requestedIp?: string) {
    const identifier = this.normalizeIdentifier(dto.identifier);
    await this.assertAuthRateLimit('forgot', `${requestedIp || 'unknown'}:${identifier}`, 5, 900);
    await this.assertAuthRateLimit('forgot-ip', requestedIp || 'unknown', 20, 900);
    await this.assertAuthRateLimit('forgot-account', identifier, 5, 900);
    const user = await this.findUserByIdentifier(identifier);
    const generic = {
      status: 'ok',
      message: 'Si el usuario existe, se enviará un enlace de recuperación.',
    };

    if (!user || user.status !== 'active') {
      return generic;
    }

    const token = this.generateToken();
    const expiresAt = new Date(Date.now() + this.resetTokenTtlMinutes() * 60 * 1000);
    await this.resetTokenModel.create({
      userId: user._id,
      tokenHash: this.hashToken(token),
      expiresAt,
      requestedIp,
    });

    const resetUrl = this.buildResetUrl(token);
    await this.sendRecoveryEmail(user.email, resetUrl).catch(() => {
      this.logger.warn('Password recovery email could not be delivered; check the mail provider');
    });
    // Never reveal whether the account exists or how it is delivered.
    return generic;
  }

  async resetPassword(dto: ResetPasswordDto) {
    await this.assertAuthRateLimit('reset', this.hashToken(dto.token || 'empty'), 8, 900);
    const tokenHash = this.hashToken(dto.token);
    const reset = await this.resetTokenModel
      .findOne({ tokenHash, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } })
      .exec();

    if (!reset) {
      throw new UnauthorizedException('Token de recuperación inválido o expirado');
    }

    const user = await this.userModel.findById(reset.userId).exec();
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Usuario inválido');
    }

    const passwordHash = await this.hashPassword(dto.password);
    const consumed = await this.resetTokenModel.findOneAndUpdate(
      { _id: reset._id, usedAt: { $exists: false }, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { new: true },
    ).exec();
    if (!consumed) throw new UnauthorizedException('Token de recuperación inválido o expirado');
    const updated = await this.userModel.updateOne({ _id: user._id, status: 'active' }, {
      $set: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
      $inc: { sessionVersion: 1 },
    }).exec();
    if (!updated.matchedCount) throw new UnauthorizedException('Usuario inválido');
    await this.resetTokenModel.updateMany({ userId: user._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } }).exec();

    return { status: 'ok', message: 'Contraseña actualizada' };
  }

  async changePassword(user: any, dto: ChangePasswordDto) {
    const found = await this.userModel.findById(user.userId).exec();
    if (!found) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const validPassword = await this.verifyPassword(dto.currentPassword, found.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Contraseña actual incorrecta');
    }

    const updated = await this.userModel.updateOne({ _id: found._id, status: 'active' }, {
      $set: { passwordHash: await this.hashPassword(dto.newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
      $inc: { sessionVersion: 1 },
    }).exec();
    if (!updated.matchedCount) throw new UnauthorizedException('Usuario inválido');
    await this.resetTokenModel.updateMany({ userId: found._id, usedAt: { $exists: false } }, { $set: { usedAt: new Date() } }).exec();
    return { status: 'ok', message: 'Contraseña actualizada' };
  }

  async validateToken(payload: any): Promise<any> {
    if (!payload || !Types.ObjectId.isValid(payload.sub) || !Number.isInteger(payload.ver)) {
      throw new UnauthorizedException('Token inválido');
    }
    const user = await this.userModel.findById(payload.sub).exec();
    if (!user || user.status !== 'active' || payload.ver !== (user.sessionVersion || 0)) {
      throw new UnauthorizedException('Sesión revocada');
    }
    if (user.passwordChangedAt && (!Number.isFinite(payload.iat) || payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000))) {
      throw new UnauthorizedException('Sesión revocada');
    }
    return {
      userId: String(user._id),
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }

  private async ensureInitialOwner() {
    const count = await this.userModel.estimatedDocumentCount().exec();
    if (count > 0) return;

    const username = this.firstEnvUser();
    const password = this.configService.get<string>('OSINT_INITIAL_OWNER_PASSWORD') || this.configService.get<string>('OSINT_AUTH_PASSWORD');
    if (!username || !password) {
      this.logger.warn('No auth users found and no initial owner env configured');
      return;
    }

    const email = this.configService.get<string>('OSINT_INITIAL_OWNER_EMAIL') || `${username}@osint.local`;
    await this.userModel.create({
      email: this.normalizeIdentifier(email),
      username: this.normalizeIdentifier(username),
      displayName: 'Owner OSINT-Deco',
      passwordHash: await this.hashPassword(password),
      role: 'admin',
      status: 'active',
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      metadata: { source: 'initial-owner-env' },
    });
    this.logger.log(`Initial owner user provisioned: ${username}`);
  }

  private async ensureDemoUsers() {
    if (this.configService.get<string>('AUTH_SEED_DEMO_USERS') !== 'true') {
      return;
    }

    if (this.configService.get<string>('NODE_ENV') === 'production') {
      this.logger.warn('AUTH_SEED_DEMO_USERS ignored in production');
      return;
    }

    if (this.configService.get<string>('AUTH_DEMO_USERS_CONFIRM') !== 'I_UNDERSTAND_LOCAL_ONLY') {
      this.logger.warn('AUTH_SEED_DEMO_USERS ignored without AUTH_DEMO_USERS_CONFIRM');
      return;
    }

    const password =
      this.configService.get<string>('AUTH_DEMO_PASSWORD') ||
      this.configService.get<string>('OSINT_INITIAL_OWNER_PASSWORD') ||
      this.configService.get<string>('OSINT_AUTH_PASSWORD');

    if (!password) {
      this.logger.warn('AUTH_SEED_DEMO_USERS enabled but no demo password configured');
      return;
    }

    const demoUsers: Array<{
      email: string;
      username: string;
      displayName: string;
      role: UserRole;
    }> = [
      {
        email: 'owner.operador-demo@yopmail.com',
        username: 'owner-osint',
        displayName: 'Owner deco31416.com',
        role: 'admin',
      },
      {
        email: 'analyst.operador-demo@yopmail.com',
        username: 'analyst-osint',
        displayName: 'Analista OSINT',
        role: 'analyst',
      },
      {
        email: 'viewer.operador-demo@yopmail.com',
        username: 'viewer-osint',
        displayName: 'Cliente Viewer',
        role: 'viewer',
      },
    ];

    let created = 0;
    for (const demo of demoUsers) {
      const exists = await this.userModel.exists({
        $or: [{ email: demo.email }, { username: demo.username }],
      });
      if (exists) continue;

      await this.userModel.create({
        ...demo,
        passwordHash: await this.hashPassword(password),
        status: 'active',
        mustChangePassword: false,
        passwordChangedAt: new Date(),
        metadata: { source: 'demo-seed-local' },
      });
      created += 1;
    }

    if (created > 0) {
      this.logger.log(`Demo auth users provisioned: ${created}`);
    }
  }

  private firstEnvUser() {
    const initial = this.configService.get<string>('OSINT_INITIAL_OWNER_USERNAME');
    if (initial) return initial.trim();
    const validUsersRaw = this.configService.get<string>('OSINT_VALID_USERS') || '';
    return validUsersRaw.split(',').map((value) => value.trim()).filter(Boolean)[0] || 'admin';
  }

  private async findUserByIdentifier(identifier: string) {
    return this.userModel
      .findOne({ $or: [{ email: identifier }, { username: identifier }] })
      .exec();
  }

  private async buildAuthResponse(user: UserDocument): Promise<AuthResponseDto> {
    const payload = {
      sub: String(user._id),
      username: user.username,
      email: user.email,
      role: user.role,
      iat: Math.floor(Date.now() / 1000),
      ver: user.sessionVersion || 0,
    };

    const accessToken = this.jwtService.sign(payload);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: 86400,
      user: {
        userId: String(user._id),
        username: user.username,
        email: user.email,
        role: user.role,
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    };
  }

  private publicUser(user: UserDocument | (User & { _id?: Types.ObjectId })) {
    return {
      userId: String(user._id),
      username: user.username,
      email: user.email,
      displayName: user.displayName || user.username,
      role: user.role,
      status: user.status,
      mustChangePassword: Boolean(user.mustChangePassword),
      lastLoginAt: user.lastLoginAt,
      passwordChangedAt: user.passwordChangedAt,
    };
  }

  private async hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex');
    const derivedKey = (await scrypt(password, salt, HASH_KEY_LENGTH)) as Buffer;
    return `scrypt$16384$${HASH_KEY_LENGTH}$${salt}$${derivedKey.toString('hex')}`;
  }

  private async verifyPassword(password: string, storedHash: string) {
    const [scheme, , keyLengthRaw, salt, hash] = storedHash.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const keyLength = Number(keyLengthRaw || HASH_KEY_LENGTH);
    const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
    const stored = Buffer.from(hash, 'hex');
    return stored.length === derivedKey.length && timingSafeEqual(stored, derivedKey);
  }

  private generateToken() {
    return randomBytes(32).toString('base64url');
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private normalizeIdentifier(value: string) {
    return String(value || '').trim().toLowerCase();
  }

  private resetTokenTtlMinutes() {
    return Number(this.configService.get<string>('AUTH_RESET_TOKEN_TTL_MINUTES') || 30);
  }

  private buildResetUrl(token: string) {
    const base =
      this.configService.get<string>('DASHBOARD_PUBLIC_URL') ||
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:3003';
    return `${base.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
  }

  private async sendRecoveryEmail(email: string, resetUrl: string) {
    const from = this.configService.get<string>('AUTH_EMAIL_FROM');
    const resendKey = this.configService.get<string>('RESEND_API_KEY');
    const smtpHost = this.configService.get<string>('SMTP_HOST');
    if (!from || (!resendKey && !smtpHost)) {
      this.logger.warn('Password recovery requires AUTH_EMAIL_FROM and a mail provider');
      return;
    }
    const message = { from, to: email, subject: 'Recuperar acceso a OSINT-Deco', text: `Restablece tu contraseña mediante este enlace temporal: ${resetUrl}` };
    if (resendKey) {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Recovery email rejected');
      return;
    }
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: Number(this.configService.get<string>('SMTP_PORT') || 587),
      secure: this.configService.get<string>('SMTP_SECURE') === 'true',
      auth: smtpUser ? { user: smtpUser, pass: this.configService.get<string>('SMTP_PASSWORD') } : undefined,
      connectionTimeout: 10000, socketTimeout: 10000,
    });
    await transport.sendMail(message);
  }

  private async assertAuthRateLimit(scope: string, key: string, max: number, ttlSeconds: number) {
    const now = Date.now();
    const localKey = `${scope}:${this.hashToken(key)}`;
    for (const [entryKey, entry] of this.localAuthLimits) {
      if (entry.expiresAt <= now) this.localAuthLimits.delete(entryKey);
    }
    const entry = this.localAuthLimits.get(localKey) || { count: 0, expiresAt: now + ttlSeconds * 1000 };
    if (!this.localAuthLimits.has(localKey) && this.localAuthLimits.size >= 10000) {
      throw new HttpException('Demasiados intentos. Intenta más tarde.', HttpStatus.TOO_MANY_REQUESTS);
    }
    entry.count += 1;
    this.localAuthLimits.set(localKey, entry);
    if (entry.count > max) {
      throw new HttpException('Demasiados intentos. Espera unos minutos e intenta de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!this.redis) {
      return;
    }

    const redisKey = `auth:rate:${scope}:${this.hashToken(key)}`;
    try {
      const count = await this.redis.incr(redisKey);
      if (count === 1) {
        await this.redis.expire(redisKey, ttlSeconds);
      }
      if (count > max) {
        throw new HttpException('Demasiados intentos. Espera unos minutos e intenta de nuevo.', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`Auth rate-limit failed for ${scope}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
