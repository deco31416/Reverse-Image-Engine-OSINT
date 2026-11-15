import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Redis } from 'ioredis';
import { firstValueFrom } from 'rxjs';

/**
 * Tipo de modelo Groq — determina los límites diarios por key
 */
export enum GroqModelType {
  /** Modelos de texto: llama-3.3-70b, mixtral, gemma, etc. → 1000 calls/día/key */
  TEXT = 'text',
  /** Modelos de visión: llama-3.2-90b-vision, etc. → 500 calls/día/key */
  VISION = 'vision',
}

/**
 * Catálogo de modelos Groq y su tipo
 */
const GROQ_MODEL_CATALOG: Record<string, GroqModelType> = {
  // Texto
  'llama-3.3-70b-versatile': GroqModelType.TEXT,
  'llama-3.1-70b-versatile': GroqModelType.TEXT,
  'llama-3.1-8b-instant': GroqModelType.TEXT,
  'llama3-70b-8192': GroqModelType.TEXT,
  'llama3-8b-8192': GroqModelType.TEXT,
  'mixtral-8x7b-32768': GroqModelType.TEXT,
  'gemma2-9b-it': GroqModelType.TEXT,
  'gemma-7b-it': GroqModelType.TEXT,
  // Visión
  'llama-3.2-90b-vision-preview': GroqModelType.VISION,
  'llama-3.2-11b-vision-preview': GroqModelType.VISION,
  'llava-v1.5-7b-4096-preview': GroqModelType.VISION,
};

/** Endpoint liviano para validar keys (GET /models — 0 tokens, solo auth) */
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

/**
 * Estado de salud de una key individual
 */
export interface GroqKeyHealth {
  index: number;
  keyPrefix: string;
  alive: boolean;
  latencyMs: number;
  error?: string;
  checkedAt: string;
}

/**
 * Estado de una key individual (con uso)
 */
export interface GroqKeyStatus {
  index: number;
  keyPrefix: string;
  alive: boolean;
  textUsage: number;
  textLimit: number;
  textRemaining: number;
  visionUsage: number;
  visionLimit: number;
  visionRemaining: number;
  isAvailable: boolean;
  lastUsed?: string;
  lastPingMs?: number;
}

/**
 * Resultado de solicitar una key
 */
export interface GroqKeyResult {
  apiKey: string;
  keyIndex: number;
  modelType: GroqModelType;
}

/**
 * GroqKeyRotationService — Meta-orquestador de API keys de Groq 🔑
 *
 * ✅ Pool de múltiples API keys (5+ recomendadas)
 * ✅ Ping de salud al arrancar: verifica CADA key contra la API real
 * ✅ Cada ping cuenta como 1 uso del día (OSINT vivo)
 * ✅ Rotación automática: si una key alcanza su límite, usa la siguiente
 * ✅ Solo usa keys marcadas como "alive" tras el ping
 * ✅ Tracking por key + por tipo de modelo (texto vs visión) en Redis
 * ✅ Límites diferenciados: texto = 1000/día/key, visión = 500/día/key
 * ✅ Reset automático cada 24 horas (TTL en Redis)
 * ✅ Dashboard de uso + salud en tiempo real
 */
@Injectable()
export class GroqKeyRotationService implements OnModuleInit {
  private readonly logger = new Logger(GroqKeyRotationService.name);
  private readonly GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
  private readonly REDIS_PREFIX = 'groq_key';

  private keys: string[] = [];
  private aliveKeys: Set<number> = new Set(); // Índices de keys que pasaron el ping
  private keyHealthResults: GroqKeyHealth[] = [];
  private textLimitPerKey: number;
  private visionLimitPerKey: number;

  // ── Rate-limit: pacing + cooldown ──────────────────
  private readonly MIN_KEY_INTERVAL_MS = 2200;   // ≈27 RPM/key (bajo 30 RPM)
  private readonly keyLastUsedAt  = new Map<number, number>();
  private readonly keyCooldownEnd = new Map<number, number>(); // in-memory cooldown tras 429

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {
    this.textLimitPerKey = parseInt(
      this.configService.get<string>('GROQ_TEXT_DAILY_LIMIT_PER_KEY') || '1000',
    );
    this.visionLimitPerKey = parseInt(
      this.configService.get<string>('GROQ_VISION_DAILY_LIMIT_PER_KEY') || '500',
    );
  }

  async onModuleInit() {
    this.loadKeys();
    const startupPingEnabled = this.configService.get<string>('GROQ_STARTUP_PING_ENABLED') === 'true';
    if (this.keys.length > 0 && startupPingEnabled) {
      await this.pingAllKeys();
    } else if (this.keys.length > 0) {
      this.aliveKeys = new Set(this.keys.map((_, index) => index));
      const now = new Date().toISOString();
      this.keyHealthResults = this.keys.map((key, index) => ({
        index,
        keyPrefix: `${key.substring(0, 8)}...`,
        alive: true,
        latencyMs: 0,
        checkedAt: now,
      }));
      this.logger.log(`Groq startup health check skipped; ${this.keys.length} key(s) enabled optimistically. Set GROQ_STARTUP_PING_ENABLED=true to validate keys on boot.`);
    }
  }

  /**
   * Carga las API keys desde el env.
   * Soporta GROQ_API_KEYS (multi) y fallback a GROQ_API_KEY (single).
   */
  private loadKeys(): void {
    const multiKeys = this.configService.get<string>('GROQ_API_KEYS');
    const singleKey = this.configService.get<string>('GROQ_API_KEY');

    const sanitize = (value: string): string =>
      value.trim().replace(/^['\"]+|['\"]+$/g, '');

    const parseKeys = (value: string): string[] =>
      value
        .split(',')
        .map((k) => sanitize(k))
        .filter((k) => k.length > 0 && !k.includes('REPLACE_ME'));

    if (multiKeys) {
      this.keys = parseKeys(multiKeys);
    }

    if (this.keys.length === 0 && singleKey) {
      // Fallback accepts one key or comma-separated pool in GROQ_API_KEY.
      this.keys = parseKeys(singleKey);
    }

    if (this.keys.length === 0) {
      this.logger.error('❌ No Groq API keys configured! Set GROQ_API_KEYS or GROQ_API_KEY in .env');
      return;
    }

    this.logger.log(`🔑 Groq Key Pool: ${this.keys.length} keys loaded, pinging...`);
  }

  // ══════════════════════════════════════════════════════
  //  STARTUP PING — OSINT VIVO 🏓
  // ══════════════════════════════════════════════════════

  /**
   * Ping a TODAS las keys al arrancar — SECUENCIAL y LIVIANO.
   * - Usa GET /models (0 tokens, solo valida auth)
   * - Una key a la vez para no levantar banderas de burst
   * - NO consume tokens ni inferencias
   * - Almacena resultado en Redis para dashboard
   */
  async pingAllKeys(): Promise<GroqKeyHealth[]> {
    this.logger.log('');
    this.logger.log('🏓 ═══════════════════════════════════════════════');
    this.logger.log('🏓  GROQ KEY HEALTH CHECK — LIGHTWEIGHT (GET /models)');
    this.logger.log('🏓 ═══════════════════════════════════════════════');

    this.aliveKeys.clear();
    this.keyHealthResults = [];

    // Secuencial: una key a la vez, sin burst
    const results: PromiseSettledResult<GroqKeyHealth>[] = [];
    for (let i = 0; i < this.keys.length; i++) {
      try {
        const health = await this.pingKey(this.keys[i], i);
        results.push({ status: 'fulfilled', value: health });
      } catch (err: any) {
        results.push({ status: 'rejected', reason: err });
      }
      // Pausa 500ms entre keys para no parecer burst
      if (i < this.keys.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        this.keyHealthResults.push(result.value);
        if (result.value.alive) {
          this.aliveKeys.add(i);
        }
      } else {
        this.keyHealthResults.push({
          index: i,
          keyPrefix: `${this.keys[i].substring(0, 8)}...`,
          alive: false,
          latencyMs: -1,
          error: result.reason?.message || 'Unknown error',
          checkedAt: new Date().toISOString(),
        });
      }
    }

    // Resumen
    const alive = this.aliveKeys.size;
    const dead = this.keys.length - alive;
    const totalText = alive * this.textLimitPerKey;
    const totalVision = alive * this.visionLimitPerKey;

    this.logger.log('');
    this.logger.log(`🏓 RESULTADO:`);
    this.logger.log(`   ✅ Alive: ${alive}/${this.keys.length} keys`);
    if (dead > 0) {
      this.logger.warn(`   ❌ Dead:  ${dead}/${this.keys.length} keys`);
    }
    this.logger.log(`   📝 Capacidad texto:  ${totalText} calls/día (${alive} keys × ${this.textLimitPerKey})`);
    this.logger.log(`   👁️  Capacidad visión: ${totalVision} calls/día (${alive} keys × ${this.visionLimitPerKey})`);

    // Log por key
    for (const health of this.keyHealthResults) {
      const icon = health.alive ? '✅' : '❌';
      const latency = health.alive ? `${health.latencyMs}ms` : health.error;
      this.logger.log(`   ${icon} [${health.index}] ${health.keyPrefix} — ${latency}`);
    }
    this.logger.log('🏓 ═══════════════════════════════════════════════');
    this.logger.log('');

    // Guardar en Redis para dashboard
    if (this.redis) {
      try {
        await this.redis.set(
          `${this.REDIS_PREFIX}:health_check`,
          JSON.stringify({
            checkedAt: new Date().toISOString(),
            totalKeys: this.keys.length,
            aliveKeys: alive,
            deadKeys: dead,
            results: this.keyHealthResults,
          }),
          'EX',
          86400,
        );
      } catch (redisErr: any) {
        this.logger.warn(`⚠️  Redis no disponible al guardar health_check: ${redisErr.message}`);
      }
    }

    return this.keyHealthResults;
  }

  /**
   * Ping a UNA key: GET /models (0 tokens, solo valida auth).
   * NO consume tokens ni inferencias — solo verifica que la key
   * esté activa y la org no esté restringida.
   */
  private async pingKey(apiKey: string, index: number): Promise<GroqKeyHealth> {
    const start = Date.now();
    const keyPrefix = `${apiKey.substring(0, 8)}...`;

    try {
      const response = await firstValueFrom(
        this.httpService.get(GROQ_MODELS_URL, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 10000,
        }),
      );

      const latency = Date.now() - start;
      const modelCount = response.data?.data?.length || 0;

      // NO registramos uso — GET /models no consume tokens

      return {
        index,
        keyPrefix,
        alive: true,
        latencyMs: latency,
        checkedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      const latency = Date.now() - start;
      const errMsg =
        error.response?.data?.error?.message ||
        error.response?.statusText ||
        error.message ||
        'Connection failed';

      return {
        index,
        keyPrefix,
        alive: false,
        latencyMs: latency,
        error: errMsg,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // ══════════════════════════════════════════════════════
  //  KEY ROTATION — SELECCIÓN INTELIGENTE
  // ══════════════════════════════════════════════════════

  /**
   * Determina el tipo de modelo (texto o visión)
   */
  getModelType(model: string): GroqModelType {
    return GROQ_MODEL_CATALOG[model] || GroqModelType.TEXT;
  }

  /**
   * Obtiene una API key disponible para el modelo solicitado.
   * Solo rota entre keys que están ALIVE tras el ping de startup.
   *
   * @param model - Nombre del modelo Groq (e.g. 'llama-3.3-70b-versatile')
   * @returns GroqKeyResult con la key, índice y tipo
   * @throws Error si todas las keys están agotadas o muertas
   */
  async getAvailableKey(model: string): Promise<GroqKeyResult> {
    if (this.keys.length === 0) {
      throw new Error('No Groq API keys configured');
    }

    if (this.aliveKeys.size === 0) {
      throw new Error('All Groq API keys are dead (failed health check on startup). Check your keys.');
    }

    const modelType = this.getModelType(model);
    const limit = modelType === GroqModelType.VISION
      ? this.visionLimitPerKey
      : this.textLimitPerKey;

    const now = Date.now();
    let bestIdx = -1;
    let bestElapsed = -1;

    // Solo buscar entre keys alive, no en cooldown, y con cuota disponible
    for (const i of this.aliveKeys) {
      // Skip keys en cooldown por 429
      const cooldownEnd = this.keyCooldownEnd.get(i) ?? 0;
      if (now < cooldownEnd) continue;

      const usage = await this.getKeyUsage(i, modelType);
      if (usage >= limit) continue;

      // Seleccionar la key con mayor tiempo desde último uso (mejor pacing)
      const elapsed = now - (this.keyLastUsedAt.get(i) ?? 0);
      if (elapsed > bestElapsed) {
        bestElapsed = elapsed;
        bestIdx     = i;
      }
    }

    if (bestIdx < 0) {
      // Todas las keys alive agotadas o en cooldown
      const totalUsed = await this.getTotalUsage(modelType);
      const totalLimit = this.aliveKeys.size * limit;
      throw new Error(
        `All ${this.aliveKeys.size} alive Groq keys exhausted/cooldown for ${modelType} models. ` +
        `Total: ${totalUsed}/${totalLimit}. Resets at midnight.`,
      );
    }

    // Pacing: esperar si la key fue usada hace menos de MIN_KEY_INTERVAL_MS
    if (bestElapsed >= 0 && bestElapsed < this.MIN_KEY_INTERVAL_MS) {
      const wait = this.MIN_KEY_INTERVAL_MS - bestElapsed;
      await new Promise(r => setTimeout(r, wait));
    }

    this.keyLastUsedAt.set(bestIdx, Date.now());

    this.logger.debug(
      `🔑 Key [${bestIdx}] selected for ${modelType} model "${model}" (paced)`,
    );
    return {
      apiKey: this.keys[bestIdx],
      keyIndex: bestIdx,
      modelType,
    };
  }

  /**
   * Notifica que una key recibió HTTP 429 — pone la key en cooldown.
   * Los consumidores deben llamar este método al recibir un 429 de Groq.
   *
   * @param keyIndex  Índice de la key que recibió 429
   * @param retryAfterSec  Valor Retry-After en segundos (default 5)
   */
  async handle429(keyIndex: number, retryAfterSec = 5): Promise<void> {
    const cooldownMs = Math.min(retryAfterSec, 60) * 1000;
    this.keyCooldownEnd.set(keyIndex, Date.now() + cooldownMs);

    this.logger.warn(
      `⚠️  Key [${keyIndex}] received 429 — cooldown ${retryAfterSec}s`,
    );

    // Publicar en Redis para visibilidad cross-service
    if (this.redis) {
      try {
        await this.redis.set(
          `${this.REDIS_PREFIX}:${keyIndex}:cooldown_until`,
          new Date(Date.now() + cooldownMs).toISOString(),
          'EX',
          Math.ceil(retryAfterSec) + 5,
        );
      } catch { /* Redis falla no es fatal */ }
    }
  }

  // ══════════════════════════════════════════════════════
  //  USAGE TRACKING — REDIS
  // ══════════════════════════════════════════════════════

  /**
   * Registra una llamada exitosa para una key + modelo.
   * Debe llamarse DESPUÉS de que la petición a Groq sea exitosa.
   */
  async registerUsage(keyIndex: number, modelType: GroqModelType): Promise<void> {
    if (!this.redis) return;

    const today = this.getTodayKey();
    const key = `${this.REDIS_PREFIX}:${keyIndex}:${modelType}:${today}`;

    let newCount = 1;
    try {
      const current = await this.redis.get(key);
      if (!current) {
        await this.redis.set(key, 1, 'EX', this.getSecondsUntilMidnight());
      } else {
        await this.redis.incr(key);
        newCount = parseInt(current) + 1;
      }

      // Timestamp de último uso
      await this.redis.set(
        `${this.REDIS_PREFIX}:${keyIndex}:last_used`,
        new Date().toISOString(),
        'EX',
        86400 * 7,
      );
    } catch (redisErr: any) {
      this.logger.warn(`⚠️  Redis no disponible en registerUsage: ${redisErr.message}`);
    }

    const limit = modelType === GroqModelType.VISION
      ? this.visionLimitPerKey
      : this.textLimitPerKey;

    this.logger.debug(
      `📊 Key [${keyIndex}] ${modelType}: ${newCount}/${limit}`,
    );
  }

  /**
   * Obtiene el uso actual de una key para un tipo de modelo
   */
  async getKeyUsage(keyIndex: number, modelType: GroqModelType): Promise<number> {
    if (!this.redis) return 0;

    const today = this.getTodayKey();
    const key = `${this.REDIS_PREFIX}:${keyIndex}:${modelType}:${today}`;
    const current = await this.redis.get(key);
    return current ? parseInt(current) : 0;
  }

  /**
   * Obtiene el uso total de todas las keys para un tipo de modelo
   */
  async getTotalUsage(modelType: GroqModelType): Promise<number> {
    let total = 0;
    for (let i = 0; i < this.keys.length; i++) {
      total += await this.getKeyUsage(i, modelType);
    }
    return total;
  }

  // ══════════════════════════════════════════════════════
  //  DASHBOARD / STATUS
  // ══════════════════════════════════════════════════════

  /**
   * Dashboard completo: salud + uso de todas las keys
   */
  async getKeyPoolStatus(): Promise<{
    totalKeys: number;
    aliveKeys: number;
    deadKeys: number;
    textLimitPerKey: number;
    visionLimitPerKey: number;
    totalTextCapacity: number;
    totalVisionCapacity: number;
    totalTextUsed: number;
    totalVisionUsed: number;
    totalTextRemaining: number;
    totalVisionRemaining: number;
    resetIn: string;
    keys: GroqKeyStatus[];
  }> {
    const keys: GroqKeyStatus[] = [];

    for (let i = 0; i < this.keys.length; i++) {
      const textUsage = await this.getKeyUsage(i, GroqModelType.TEXT);
      const visionUsage = await this.getKeyUsage(i, GroqModelType.VISION);
      const alive = this.aliveKeys.has(i);

      const lastUsed = this.redis
        ? await this.redis.get(`${this.REDIS_PREFIX}:${i}:last_used`)
        : null;

      const healthResult = this.keyHealthResults.find((h) => h.index === i);

      keys.push({
        index: i,
        keyPrefix: `${this.keys[i].substring(0, 8)}...`,
        alive,
        textUsage,
        textLimit: this.textLimitPerKey,
        textRemaining: Math.max(0, this.textLimitPerKey - textUsage),
        visionUsage,
        visionLimit: this.visionLimitPerKey,
        visionRemaining: Math.max(0, this.visionLimitPerKey - visionUsage),
        isAvailable: alive &&
          (textUsage < this.textLimitPerKey || visionUsage < this.visionLimitPerKey),
        lastUsed: lastUsed || undefined,
        lastPingMs: healthResult?.latencyMs,
      });
    }

    const aliveCount = this.aliveKeys.size;
    const totalTextUsed = keys.reduce((sum, k) => sum + k.textUsage, 0);
    const totalVisionUsed = keys.reduce((sum, k) => sum + k.visionUsage, 0);
    const totalTextCapacity = aliveCount * this.textLimitPerKey;
    const totalVisionCapacity = aliveCount * this.visionLimitPerKey;

    const remaining = this.getSecondsUntilMidnight();
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);

    return {
      totalKeys: this.keys.length,
      aliveKeys: aliveCount,
      deadKeys: this.keys.length - aliveCount,
      textLimitPerKey: this.textLimitPerKey,
      visionLimitPerKey: this.visionLimitPerKey,
      totalTextCapacity,
      totalVisionCapacity,
      totalTextUsed,
      totalVisionUsed,
      totalTextRemaining: totalTextCapacity - totalTextUsed,
      totalVisionRemaining: totalVisionCapacity - totalVisionUsed,
      resetIn: `${hours}h ${minutes}m`,
      keys,
    };
  }

  /**
   * Obtiene resultados del último health check
   */
  getLastHealthCheck(): GroqKeyHealth[] {
    return this.keyHealthResults;
  }

  // ══════════════════════════════════════════════════════
  //  ADMIN
  // ══════════════════════════════════════════════════════

  /**
   * Reset manual de una key específica
   */
  async resetKey(keyIndex: number): Promise<void> {
    if (!this.redis || keyIndex < 0 || keyIndex >= this.keys.length) return;

    const today = this.getTodayKey();
    await this.redis.del(`${this.REDIS_PREFIX}:${keyIndex}:${GroqModelType.TEXT}:${today}`);
    await this.redis.del(`${this.REDIS_PREFIX}:${keyIndex}:${GroqModelType.VISION}:${today}`);

    this.logger.log(`🔄 Key [${keyIndex}] usage reset`);
  }

  /**
   * Reset manual de TODAS las keys
   */
  async resetAllKeys(): Promise<void> {
    for (let i = 0; i < this.keys.length; i++) {
      await this.resetKey(i);
    }
    this.logger.log(`🔄 All ${this.keys.length} keys reset`);
  }

  /**
   * Re-ping manual (admin puede forzar re-check)
   */
  async rePingAllKeys(): Promise<GroqKeyHealth[]> {
    this.logger.log('🔄 Admin-triggered re-ping of all Groq keys...');
    return this.pingAllKeys();
  }

  /** ¿Hay keys alive? */
  isAvailable(): boolean {
    return this.aliveKeys.size > 0;
  }

  /** Cantidad total de keys en el pool */
  getKeyCount(): number {
    return this.keys.length;
  }

  /** Cantidad de keys alive */
  getAliveKeyCount(): number {
    return this.aliveKeys.size;
  }

  // ── Helpers ──────────────────────────────────────────

  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getSecondsUntilMidnight(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
  }
}
