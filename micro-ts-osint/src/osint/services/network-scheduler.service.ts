import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Per-domain pool configuration
 */
export interface DomainPoolConfig {
  /** Max concurrent requests for this domain */
  concurrency: number;
  /** Min delay between requests in ms (anti-detection) */
  minDelay: number;
  /** Max delay between requests in ms (randomized) */
  maxDelay: number;
  /** Max consecutive failures before circuit opens */
  failureThreshold: number;
  /** How long circuit stays open (ms) — escalates dynamically */
  circuitResetTimeout: number;
  /** Max retries on ETIMEDOUT / network errors */
  maxRetries: number;
}

/**
 * Case profile — controls global behavior per investigation type
 */
export interface CaseProfile {
  globalMaxConcurrent: number;
  globalRatePerMin: number;
  queryBudget: number;
  deepSearch: boolean;
  allowTier2: boolean;
  /** Multiplier applied to all delays (1.0 = normal, 2.0 = double) */
  delayMultiplier: number;
  /** Stealth pause: sleep N ms every M requests */
  stealthPauseEvery: number;
  stealthPauseMs: [number, number]; // [min, max]
}

interface CircuitState {
  failures: number;
  isOpen: boolean;
  openedAt: number;
  totalRequests: number;
  totalFailures: number;
  totalSuccesses: number;
  lastError?: string;
  /** How many times circuit has opened for this domain (escalation) */
  openCount: number;
}

interface QueueItem<T> {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: any) => void;
  retries: number;
  domain: string;
}

/** Telemetry event for request ledger */
export interface NetworkEvent {
  timestamp: number;
  domain: string;
  queryHash: string;
  status: 'ok' | 'fail' | 'circuit-open';
  latencyMs: number;
  retries: number;
  errorCode?: string;
}

/**
 * NetworkSchedulerService — Elite-level outbound traffic controller
 *
 * Features:
 * - Per-domain concurrency pools with individual queues
 * - GLOBAL concurrency + rate-per-minute governor (single IP protection)
 * - Circuit breaker per domain with escalating cooldowns
 * - Exponential delay distribution (human-like, not uniform)
 * - Dynamic delay adjustment based on failure rate + latency
 * - Global jitter between cross-domain requests (anti-pattern detection)
 * - Shadow-ban detection (auto-pause domain if 12+ failures, 0 successes)
 * - Stealth cooldown every N requests (simulates human pauses)
 * - Adaptive latency tracking per domain
 * - Case profiles: silent / stealth / standard / aggressive
 * - Request ledger for auditing (hashed queries, no PII)
 * - Professional backoff: exponential + full jitter (no detectable patterns)
 */
@Injectable()
export class NetworkSchedulerService {
  private readonly logger = new Logger(NetworkSchedulerService.name);

  // ─── GLOBAL TRAFFIC GOVERNOR ─────────────────────────────────
  private globalActive = 0;
  private GLOBAL_MAX_CONCURRENT = 6;
  private GLOBAL_RATE_LIMIT_PER_MIN = 70;
  private globalRecentTimestamps: number[] = [];
  private totalRequestsExecuted = 0;

  // ─── CASE PROFILES ───────────────────────────────────────────
  static readonly CASE_PROFILES: Record<string, CaseProfile> = {
    silent: {
      globalMaxConcurrent: 2,
      globalRatePerMin: 20,
      queryBudget: 12,
      deepSearch: false,
      allowTier2: false,
      delayMultiplier: 2.5,
      stealthPauseEvery: 8,
      stealthPauseMs: [8000, 25000],
    },
    stealth: {
      globalMaxConcurrent: 4,
      globalRatePerMin: 50,
      queryBudget: 15,
      deepSearch: false,
      allowTier2: false,
      delayMultiplier: 1.8,
      stealthPauseEvery: 15,
      stealthPauseMs: [5000, 15000],
    },
    standard: {
      globalMaxConcurrent: 6,
      globalRatePerMin: 70,
      queryBudget: 20,
      deepSearch: false,
      allowTier2: true,
      delayMultiplier: 1.0,
      stealthPauseEvery: 40,
      stealthPauseMs: [5000, 10000],
    },
    aggressive: {
      globalMaxConcurrent: 8,
      globalRatePerMin: 100,
      queryBudget: 30,
      deepSearch: true,
      allowTier2: true,
      delayMultiplier: 0.7,
      stealthPauseEvery: 60,
      stealthPauseMs: [3000, 7000],
    },
  };

  private activeCaseProfile: CaseProfile = NetworkSchedulerService.CASE_PROFILES['standard'];

  /** Per-domain configuration */
  private readonly poolConfigs: Record<string, DomainPoolConfig> = {
    duckduckgo: {
      concurrency: 1,        // bajado a 1 para max stealth
      minDelay: 1500,         // subido — DDG es el más sensible
      maxDelay: 4000,
      failureThreshold: 4,
      circuitResetTimeout: 60_000,
      maxRetries: 2,
    },
    searxng: {
      concurrency: 2,
      minDelay: 400,
      maxDelay: 1200,
      failureThreshold: 6,
      circuitResetTimeout: 30_000,
      maxRetries: 2,
    },
    bing: {
      concurrency: 2,
      minDelay: 200,
      maxDelay: 800,
      failureThreshold: 5,
      circuitResetTimeout: 30_000,
      maxRetries: 2,
    },
    tavily: {
      concurrency: 2,
      minDelay: 100,
      maxDelay: 500,
      failureThreshold: 3,
      circuitResetTimeout: 30_000,
      maxRetries: 1,
    },
    serper: {
      concurrency: 2,
      minDelay: 100,
      maxDelay: 500,
      failureThreshold: 3,
      circuitResetTimeout: 30_000,
      maxRetries: 1,
    },
    brave: {
      concurrency: 2,
      minDelay: 100,
      maxDelay: 500,
      failureThreshold: 3,
      circuitResetTimeout: 30_000,
      maxRetries: 1,
    },
    youtube: {
      concurrency: 2,
      minDelay: 300,
      maxDelay: 800,
      failureThreshold: 5,
      circuitResetTimeout: 30_000,
      maxRetries: 1,
    },
    webarchive: {
      concurrency: 1,         // bajado — Wayback es lento + timeout
      minDelay: 800,
      maxDelay: 2500,
      failureThreshold: 4,
      circuitResetTimeout: 60_000,
      maxRetries: 1,
    },
    yandex: {
      concurrency: 1,         // bajado — Yandex es agresivo con bans
      minDelay: 1200,
      maxDelay: 3500,
      failureThreshold: 3,
      circuitResetTimeout: 90_000,
      maxRetries: 2,
    },
    'reverse-image': {
      concurrency: 1,
      minDelay: 1000,
      maxDelay: 2500,
      failureThreshold: 3,
      circuitResetTimeout: 60_000,
      maxRetries: 1,
    },
    sanctions: {
      concurrency: 2,
      minDelay: 200,
      maxDelay: 600,
      failureThreshold: 3,
      circuitResetTimeout: 30_000,
      maxRetries: 1,
    },
    crawler: {
      concurrency: 1,
      minDelay: 1200,
      maxDelay: 3500,
      failureThreshold: 4,
      circuitResetTimeout: 60_000,
      maxRetries: 1,
    },
  };

  /** Default config for unknown domains */
  private readonly defaultConfig: DomainPoolConfig = {
    concurrency: 1,
    minDelay: 800,
    maxDelay: 2000,
    failureThreshold: 4,
    circuitResetTimeout: 30_000,
    maxRetries: 1,
  };

  /** Circuit breaker state per domain */
  private circuits: Map<string, CircuitState> = new Map();

  /** Active request count per domain */
  private activeRequests: Map<string, number> = new Map();

  /** Queue of pending operations per domain */
  private queues: Map<string, Array<QueueItem<any>>> = new Map();

  /** Last request timestamp per domain (for delay spacing) */
  private lastRequestTime: Map<string, number> = new Map();

  /** Latency tracking per domain (rolling window of last 20) */
  private domainLatency: Map<string, number[]> = new Map();

  /** Request ledger for auditing (last 500 events) */
  private requestLedger: NetworkEvent[] = [];
  private readonly MAX_LEDGER_SIZE = 500;

  /** In-memory response cache (query dedup) */
  private responseCache = new Map<string, { expiresAt: number; data: any }>();

  constructor() {
    this.logger.log('🌐 NetworkScheduler ELITE initialized');
    this.logger.log(
      `   Global: max=${this.GLOBAL_MAX_CONCURRENT} concurrent, ` +
      `${this.GLOBAL_RATE_LIMIT_PER_MIN}/min, profile=standard`,
    );
    for (const domain of Object.keys(this.poolConfigs)) {
      const cfg = this.poolConfigs[domain];
      this.logger.debug(`   ${domain}: concurrency=${cfg.concurrency}, delay=${cfg.minDelay}-${cfg.maxDelay}ms`);
    }
  }

  // ─── PUBLIC API ────────────────────────────────────────────────

  /**
   * Apply a case profile to control global behavior.
   * Called by the orchestrator at the start of each search.
   */
  applyCaseProfile(profileName: string): void {
    const profile = NetworkSchedulerService.CASE_PROFILES[profileName];
    if (!profile) {
      this.logger.warn(`Unknown case profile "${profileName}" — using standard`);
      this.activeCaseProfile = NetworkSchedulerService.CASE_PROFILES['standard'];
      return;
    }
    this.activeCaseProfile = profile;
    this.GLOBAL_MAX_CONCURRENT = profile.globalMaxConcurrent;
    this.GLOBAL_RATE_LIMIT_PER_MIN = profile.globalRatePerMin;
    this.logger.log(
      `🎯 Case profile applied: ${profileName} → ` +
      `global=${profile.globalMaxConcurrent}c/${profile.globalRatePerMin}rpm, ` +
      `budget=${profile.queryBudget}, delay×${profile.delayMultiplier}`,
    );
  }

  /** Get active case profile */
  getCaseProfile(): CaseProfile {
    return this.activeCaseProfile;
  }

  /**
   * Schedule an operation on a specific domain's queue.
   * Respects per-domain concurrency, global governor, delays, and circuit breaker.
   */
  async schedule<T>(domain: string, operation: () => Promise<T>): Promise<T> {
    const config = this.getConfig(domain);

    // Check circuit breaker
    if (this.isCircuitOpen(domain)) {
      const circuit = this.circuits.get(domain)!;
      const cooldown = this.getEscalatedCooldown(domain);
      const elapsed = Date.now() - circuit.openedAt;
      const remaining = Math.ceil((cooldown - elapsed) / 1000);

      if (elapsed >= cooldown) {
        this.logger.log(`🔄 Circuit half-open for ${domain} — testing with 1 request...`);
        circuit.isOpen = false;
        circuit.failures = 0;
      } else {
        this.logger.warn(
          `⚡ Circuit OPEN for ${domain} — ${circuit.failures} failures, ` +
          `cooldown ${remaining}s (escalation #${circuit.openCount}). Last: ${circuit.lastError}`,
        );
        this.recordLedger(domain, '', 'circuit-open', 0, 0);
        throw new Error(`Circuit breaker OPEN for ${domain} — retry in ${remaining}s`);
      }
    }

    // Enqueue and process
    return new Promise<T>((resolve, reject) => {
      const queue = this.getQueue(domain);
      queue.push({ operation, resolve, reject, retries: 0, domain });
      this.processQueue(domain);
    });
  }

  /**
   * Schedule an operation with in-memory cache deduplication.
   * If the same domain+queryKey was requested recently, returns cached result.
   */
  async scheduleWithCache<T>(
    domain: string,
    queryKey: string,
    operation: () => Promise<T>,
    ttlMs = 60_000,
  ): Promise<T> {
    const cacheKey = `${domain}:${this.hashQuery(queryKey)}`;
    const cached = this.getFromCache(cacheKey);
    if (cached !== null) {
      this.logger.debug(`📦 Cache HIT: ${domain}:${this.hashQuery(queryKey).substring(0, 8)}`);
      return cached as T;
    }

    const result = await this.schedule(domain, operation);
    this.setCache(cacheKey, result, ttlMs);
    return result;
  }

  /**
   * Schedule multiple operations on the same domain.
   */
  async scheduleAll<T>(
    domain: string,
    operations: Array<() => Promise<T>>,
  ): Promise<Array<PromiseSettledResult<T>>> {
    const promises = operations.map((op) =>
      this.schedule(domain, op).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      ),
    );
    return Promise.all(promises);
  }

  /**
   * Schedule operations across MULTIPLE domains in parallel.
   * Each domain queue runs independently; global governor limits total.
   */
  async scheduleMultiDomain<T>(
    tasks: Array<{ domain: string; operation: () => Promise<T>; label?: string }>,
  ): Promise<Array<PromiseSettledResult<T>>> {
    const promises = tasks.map((task) =>
      this.schedule(task.domain, task.operation).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (reason) => ({ status: 'rejected' as const, reason }),
      ),
    );
    return Promise.all(promises);
  }

  /**
   * Get real-time stats for all domains + global metrics
   */
  getStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    // Global stats
    stats._global = {
      active: this.globalActive,
      maxConcurrent: this.GLOBAL_MAX_CONCURRENT,
      ratePerMin: this.GLOBAL_RATE_LIMIT_PER_MIN,
      totalExecuted: this.totalRequestsExecuted,
      recentPerMin: this.globalRecentTimestamps.filter(ts => ts > Date.now() - 60_000).length,
      caseProfile: Object.entries(NetworkSchedulerService.CASE_PROFILES)
        .find(([, p]) => p === this.activeCaseProfile)?.[0] || 'custom',
      cacheSize: this.responseCache.size,
      ledgerSize: this.requestLedger.length,
    };

    // Per-domain stats
    for (const domain of Object.keys(this.poolConfigs)) {
      const latencies = this.domainLatency.get(domain) || [];
      const avgLatency = latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;

      stats[domain] = {
        active: this.activeRequests.get(domain) || 0,
        queued: this.getQueue(domain).length,
        circuit: this.circuits.get(domain) || this.getDefaultCircuit(),
        config: this.poolConfigs[domain],
        avgLatencyMs: avgLatency,
      };
    }
    return stats;
  }

  /** Get request ledger (for audit endpoint) */
  getLedger(): NetworkEvent[] {
    return [...this.requestLedger];
  }

  /** Hash a query string for OPSEC-safe logging */
  hashQuery(query: string): string {
    return crypto.createHash('sha256').update(query).digest('hex').substring(0, 12);
  }

  // ─── PRIVATE: Global Governor ──────────────────────────────────

  /**
   * Enforce global concurrency + rate-per-minute limits.
   * This is what prevents burning a single IP.
   */
  private async enforceGlobalLimits(): Promise<void> {
    // Concurrency: wait until a slot opens
    while (this.globalActive >= this.GLOBAL_MAX_CONCURRENT) {
      await this.sleep(150 + Math.random() * 200);
    }

    // Rate per minute: if exceeded, cool down
    const oneMinAgo = Date.now() - 60_000;
    this.globalRecentTimestamps = this.globalRecentTimestamps.filter(ts => ts > oneMinAgo);

    if (this.globalRecentTimestamps.length >= this.GLOBAL_RATE_LIMIT_PER_MIN) {
      const cooldown = 8000 + Math.random() * 8000;
      this.logger.warn(
        `🚦 Global rate limit hit (${this.globalRecentTimestamps.length}/${this.GLOBAL_RATE_LIMIT_PER_MIN}/min) ` +
        `→ cooldown ${Math.round(cooldown / 1000)}s`,
      );
      await this.sleep(cooldown);
    }

    this.globalRecentTimestamps.push(Date.now());
  }

  /**
   * Global jitter — adds micro-delay between cross-domain requests
   * to break robotic traffic patterns from a single IP.
   */
  private async globalJitter(): Promise<void> {
    const jitter = Math.random() * 150 * this.activeCaseProfile.delayMultiplier;
    if (jitter > 60) {
      await this.sleep(jitter);
    }
  }

  /**
   * Stealth cooldown — every N requests, simulate human pause
   */
  private async stealthCooldown(): Promise<void> {
    const profile = this.activeCaseProfile;
    if (this.totalRequestsExecuted > 0 && this.totalRequestsExecuted % profile.stealthPauseEvery === 0) {
      const [min, max] = profile.stealthPauseMs;
      const pause = min + Math.random() * (max - min);
      this.logger.warn(
        `🧊 Stealth cooldown #${Math.floor(this.totalRequestsExecuted / profile.stealthPauseEvery)} ` +
        `→ ${Math.round(pause / 1000)}s pause (simulating human break)`,
      );
      await this.sleep(pause);
    }
  }

  // ─── PRIVATE: Queue Processing ─────────────────────────────────

  private getQueue(domain: string): Array<QueueItem<any>> {
    if (!this.queues.has(domain)) {
      this.queues.set(domain, []);
    }
    return this.queues.get(domain)!;
  }

  private getActiveCount(domain: string): number {
    return this.activeRequests.get(domain) || 0;
  }

  private getConfig(domain: string): DomainPoolConfig {
    return this.poolConfigs[domain] || this.defaultConfig;
  }

  private getCircuit(domain: string): CircuitState {
    if (!this.circuits.has(domain)) {
      this.circuits.set(domain, this.getDefaultCircuit());
    }
    return this.circuits.get(domain)!;
  }

  private getDefaultCircuit(): CircuitState {
    return {
      failures: 0,
      isOpen: false,
      openedAt: 0,
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      openCount: 0,
    };
  }

  private isCircuitOpen(domain: string): boolean {
    const circuit = this.circuits.get(domain);
    return circuit?.isOpen === true;
  }

  /**
   * Process the next item in a domain's queue.
   * Full flow: global limits → domain concurrency → delay → jitter → execute
   */
  private async processQueue(domain: string): Promise<void> {
    const config = this.getConfig(domain);
    const queue = this.getQueue(domain);
    const activeCount = this.getActiveCount(domain);

    if (activeCount >= config.concurrency || queue.length === 0) {
      return;
    }

    const item = queue.shift()!;
    this.activeRequests.set(domain, activeCount + 1);

    try {
      // ── GLOBAL GOVERNOR: wait for global slot + rate ──
      await this.enforceGlobalLimits();
      this.globalActive++;

      try {
        // ── PER-DOMAIN DELAY (exponential, dynamic) ──
        await this.applyDelay(domain);

        // ── GLOBAL JITTER (cross-domain anti-pattern) ──
        await this.globalJitter();

        // ── EXECUTE ──
        const start = Date.now();
        const result = await item.operation();
        const latency = Date.now() - start;

        // Track latency + success
        this.recordLatency(domain, latency);
        this.recordSuccess(domain);
        this.recordLedger(domain, '', 'ok', latency, item.retries);

        // ── STEALTH COOLDOWN (every N requests) ──
        await this.stealthCooldown();

        item.resolve(result);
      } finally {
        this.globalActive = Math.max(0, this.globalActive - 1);
      }
    } catch (error: any) {
      // Check if retryable
      if (this.isRetryable(error) && item.retries < config.maxRetries) {
        item.retries++;

        // Professional backoff: exponential + full jitter (no fixed patterns)
        const base = 600;
        const exponential = Math.pow(2, item.retries) * base;
        const jitter = Math.random() * exponential;
        const backoffMs = exponential + jitter;

        this.logger.warn(
          `🔄 Retry ${item.retries}/${config.maxRetries} for ${domain} ` +
          `in ${Math.round(backoffMs)}ms — ${error.code || error.message}`,
        );

        setTimeout(() => {
          queue.unshift(item);
          this.processQueue(domain);
        }, backoffMs);
      } else {
        this.recordFailure(domain, error.message);
        this.recordLedger(domain, '', 'fail', 0, item.retries, error.code || error.message);
        item.reject(error);
      }
    } finally {
      const current = this.getActiveCount(domain);
      this.activeRequests.set(domain, Math.max(0, current - 1));
      setImmediate(() => this.processQueue(domain));
    }
  }

  // ─── PRIVATE: Human-like Delay System ──────────────────────────

  /**
   * Exponential distribution — much more human-like than uniform random.
   * Produces mostly short delays with occasional long ones.
   */
  private randomExp(mean: number): number {
    return -Math.log(1 - Math.random()) * mean;
  }

  /**
   * Dynamic minimum delay — increases automatically when failures accumulate
   * or latency degrades (adaptive stealth).
   */
  private dynamicMin(domain: string): number {
    const config = this.getConfig(domain);
    const circuit = this.getCircuit(domain);
    const base = config.minDelay;

    // Penalty: more failures → longer min delay (auto-throttle)
    const failurePenalty = Math.min(circuit.failures * 120, 2500);

    // Penalty: high latency signals pre-throttling by provider
    const latencies = this.domainLatency.get(domain) || [];
    const avgLatency = latencies.length
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0;
    const latencyPenalty = avgLatency > 2000 ? 1000 : avgLatency > 1000 ? 400 : 0;

    return base + failurePenalty + latencyPenalty;
  }

  private dynamicMax(domain: string): number {
    const config = this.getConfig(domain);
    const circuit = this.getCircuit(domain);
    // Escalate max delay too if under pressure
    const escalation = Math.min(circuit.failures * 200, 3000);
    return config.maxDelay + escalation;
  }

  /**
   * Apply delay with exponential distribution + dynamic adjustment + case profile multiplier
   */
  private async applyDelay(domain: string): Promise<void> {
    const lastTime = this.lastRequestTime.get(domain) || 0;
    const elapsed = Date.now() - lastTime;

    const min = this.dynamicMin(domain);
    const max = this.dynamicMax(domain);
    const mean = (min + max) / 2;

    // Exponential distribution × case profile delay multiplier
    const targetDelay = this.randomExp(mean) * this.activeCaseProfile.delayMultiplier;
    const remaining = Math.max(0, targetDelay - elapsed);

    if (remaining > 0) {
      await this.sleep(remaining);
    }

    this.lastRequestTime.set(domain, Date.now());
  }

  // ─── PRIVATE: Circuit Breaker + Shadow-ban ─────────────────────

  private recordSuccess(domain: string): void {
    const circuit = this.getCircuit(domain);
    circuit.failures = 0;
    circuit.totalSuccesses++;
    circuit.totalRequests++;
    this.totalRequestsExecuted++;
  }

  private recordFailure(domain: string, errorMessage: string): void {
    const circuit = this.getCircuit(domain);
    const config = this.getConfig(domain);

    circuit.failures++;
    circuit.totalFailures++;
    circuit.totalRequests++;
    circuit.lastError = errorMessage;

    // Circuit breaker: open after N consecutive failures
    if (circuit.failures >= config.failureThreshold && !circuit.isOpen) {
      circuit.isOpen = true;
      circuit.openedAt = Date.now();
      circuit.openCount++;

      const cooldown = this.getEscalatedCooldown(domain);
      this.logger.error(
        `🔴 Circuit OPENED for ${domain} — ${circuit.failures} consecutive failures! ` +
        `Cooldown ${Math.round(cooldown / 1000)}s (escalation #${circuit.openCount}). ` +
        `Last: ${errorMessage}`,
      );
    }

    // Shadow-ban detection: many failures, zero successes → provider blocking us
    if (circuit.totalFailures > 12 && circuit.totalSuccesses === 0) {
      this.logger.error(
        `🚨 SHADOW-BAN detected for ${domain}! ` +
        `${circuit.totalFailures} failures, 0 successes. Domain paused 2min.`,
      );
      circuit.isOpen = true;
      circuit.openedAt = Date.now();
      circuit.openCount = Math.max(circuit.openCount, 3); // force high escalation
    }
  }

  /**
   * Escalating cooldown: more circuit opens → exponentially longer cooldown.
   * Prevents hammering a provider that has already blocked us.
   *
   * Opens: 1 → 60s, 2 → 120s, 3 → 300s, 4+ → 300s (cap)
   */
  private getEscalatedCooldown(domain: string): number {
    const config = this.getConfig(domain);
    const circuit = this.getCircuit(domain);
    const baseTimeout = config.circuitResetTimeout;
    const multiplier = Math.min(Math.pow(1.5, circuit.openCount), 5);
    return Math.min(baseTimeout * multiplier, 300_000); // cap at 5 min
  }

  // ─── PRIVATE: Latency Tracking ─────────────────────────────────

  private recordLatency(domain: string, latency: number): void {
    if (!this.domainLatency.has(domain)) {
      this.domainLatency.set(domain, []);
    }
    const arr = this.domainLatency.get(domain)!;
    arr.push(latency);
    if (arr.length > 20) arr.shift(); // rolling window
  }

  // ─── PRIVATE: Request Ledger (Audit) ───────────────────────────

  private recordLedger(
    domain: string,
    queryHash: string,
    status: 'ok' | 'fail' | 'circuit-open',
    latencyMs: number,
    retries: number,
    errorCode?: string,
  ): void {
    this.requestLedger.push({
      timestamp: Date.now(),
      domain,
      queryHash,
      status,
      latencyMs,
      retries,
      errorCode,
    });
    // Keep bounded
    if (this.requestLedger.length > this.MAX_LEDGER_SIZE) {
      this.requestLedger.splice(0, this.requestLedger.length - this.MAX_LEDGER_SIZE);
    }
  }

  // ─── PRIVATE: Response Cache ───────────────────────────────────

  private getFromCache(key: string): any | null {
    const entry = this.responseCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.responseCache.delete(key);
      return null;
    }
    return entry.data;
  }

  private setCache(key: string, data: any, ttlMs: number): void {
    this.responseCache.set(key, {
      expiresAt: Date.now() + ttlMs,
      data,
    });
    // Prevent unbounded cache growth
    if (this.responseCache.size > 500) {
      const oldest = this.responseCache.keys().next().value;
      if (oldest) this.responseCache.delete(oldest);
    }
  }

  // ─── PRIVATE: Utils ────────────────────────────────────────────

  private isRetryable(error: any): boolean {
    const code = error?.code || '';
    const message = error?.message || '';
    return (
      code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ENETUNREACH' ||
      code === 'EAI_AGAIN' ||
      message.includes('timeout') ||
      message.includes('ETIMEDOUT') ||
      message.includes('socket hang up')
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
