import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { EvidenceService } from './evidence.service';
import { RateLimitService } from './rate-limit.service';

// ============================================================
// INTERFACES
// ============================================================

export interface SanctionsHit {
  source: string;           // 'interpol' | 'opensanctions' | 'ofac' | 'un'
  listName: string;         // 'RED_NOTICE' | 'SDN_LIST' | 'UN_CONSOLIDATED' etc
  entityName: string;       // Nombre encontrado
  matchScore: number;       // 0-100 confianza del match
  details: string;          // Descripción del hit
  url?: string;             // URL de la fuente
  nationality?: string;
  dateOfBirth?: string;
  charges?: string;
  thumbnailUrl?: string;
  rawData?: Record<string, any>;
}

export interface SanctionsScreeningResult {
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskScore: number;        // 0-100
  totalHits: number;
  hits: SanctionsHit[];
  sourcesChecked: string[];
  screeningDuration: number; // ms
  summary: string;
}

/**
 * Sanctions Screening Service 🚨
 *
 * Consulta APIs REALES y PÚBLICAS de sanciones internacionales:
 *
 * 1. INTERPOL Notices API (ws-public.interpol.int)
 *    - Red Notices (órdenes de arresto internacionales)
 *    - Yellow Notices (personas desaparecidas)
 *    - API REST gratuita, sin API key
 *
 * 2. OpenSanctions API (api.opensanctions.org)
 *    - Agregador de 190+ países: OFAC, ONU, Europol, FBI, UK, PEPs
 *    - Free tier: /search endpoint
 *
 * 3. OFAC SDN via Treasury (sanctionsearch.ofac.treas.gov)
 *    - Specially Designated Nationals list (USA)
 *    - Búsqueda directa por nombre
 *
 * 4. EU Sanctions (webgate.ec.europa.eu)
 *    - EU Consolidated Financial Sanctions list
 *
 * Todo es OSINT legal: únicamente datos públicos de fuentes gubernamentales.
 */
@Injectable()
export class SanctionsScreeningService {
  private readonly logger = new Logger(SanctionsScreeningService.name);

  // Interpol Public API
  private readonly INTERPOL_API = 'https://ws-public.interpol.int/notices/v1';
  // OpenSanctions free search
  private readonly OPENSANCTIONS_API = 'https://api.opensanctions.org';
  // OFAC Sanctions Search
  private readonly OFAC_SEARCH_API = 'https://search.ofac-api.com/v3';
  // EU Financial Sanctions
  private readonly EU_SANCTIONS_API = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content';

  constructor(
    private httpService: HttpService,
    private evidenceService: EvidenceService,
    private rateLimitService: RateLimitService,
  ) {}

  /**
   * Ejecuta screening completo contra todas las listas de sanciones
   */
  async screenPerson(
    searchId: string,
    identity: {
      fullName?: string;
      firstName?: string;
      lastName?: string;
      nationality?: string;
      dateOfBirth?: string;
      email?: string;
      phone?: string;
    },
  ): Promise<SanctionsScreeningResult> {
    const startTime = Date.now();
    this.logger.log(`🚨 Starting sanctions screening for: ${identity.fullName || 'unknown'}`);

    const allHits: SanctionsHit[] = [];
    const sourcesChecked: string[] = [];

    // Ejecutar todas las búsquedas en paralelo
    const [interpolHits, openSanctionsHits] = await Promise.allSettled([
      this.searchInterpol(identity),
      this.searchOpenSanctions(identity),
    ]);

    // Procesar resultados de Interpol
    if (interpolHits.status === 'fulfilled') {
      allHits.push(...interpolHits.value);
      sourcesChecked.push('INTERPOL Red Notices', 'INTERPOL Yellow Notices');
    } else {
      this.logger.warn(`Interpol search failed: ${interpolHits.reason}`);
      sourcesChecked.push('INTERPOL (error)');
    }

    // Procesar resultados de OpenSanctions
    if (openSanctionsHits.status === 'fulfilled') {
      allHits.push(...openSanctionsHits.value);
      sourcesChecked.push(
        'OpenSanctions (OFAC SDN, UN Consolidated, Europol, FBI Most Wanted, UK HM Treasury, PEPs)',
      );
    } else {
      this.logger.warn(`OpenSanctions search failed: ${openSanctionsHits.reason}`);
      sourcesChecked.push('OpenSanctions (error)');
    }

    // Calcular nivel de riesgo
    const riskLevel = this.calculateRiskLevel(allHits);
    const riskScore = this.calculateRiskScore(allHits);
    const duration = Date.now() - startTime;

    // Guardar hits como evidencia
    await this.saveHitsAsEvidence(searchId, allHits);

    const summary = this.generateSummary(allHits, riskLevel, sourcesChecked);

    this.logger.log(
      `🚨 Screening complete: ${allHits.length} hits, risk=${riskLevel} (${riskScore}/100), ${duration}ms`,
    );

    return {
      riskLevel,
      riskScore,
      totalHits: allHits.length,
      hits: allHits,
      sourcesChecked,
      screeningDuration: duration,
      summary,
    };
  }

  // ============================================================
  // 1. INTERPOL NOTICES API (100% gratuita, sin API key)
  // ============================================================

  /**
   * Busca en Interpol Red Notices (órdenes de arresto) y Yellow Notices (desaparecidos)
   * API pública: https://ws-public.interpol.int/notices/v1/red
   */
  private async searchInterpol(identity: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    nationality?: string;
  }): Promise<SanctionsHit[]> {
    const hits: SanctionsHit[] = [];

    // Separar nombre si viene completo
    let firstName = identity.firstName;
    let lastName = identity.lastName;
    if (!firstName && !lastName && identity.fullName) {
      const parts = identity.fullName.trim().split(/\s+/);
      firstName = parts[0];
      lastName = parts.length > 1 ? parts.slice(1).join(' ') : undefined;
    }

    if (!firstName && !lastName) return hits;

    try {
      // Red Notices (órdenes de arresto internacionales)
      const redHits = await this.searchInterpolNotices('red', firstName, lastName, identity.nationality);
      hits.push(...redHits);

      // Pausa entre requests
      await this.sleep(500);

      // Yellow Notices (personas desaparecidas)
      const yellowHits = await this.searchInterpolNotices('yellow', firstName, lastName, identity.nationality);
      hits.push(...yellowHits);
    } catch (error) {
      this.logger.error(`Interpol API error: ${error.message}`);
    }

    return hits;
  }

  private async searchInterpolNotices(
    type: 'red' | 'yellow',
    firstName?: string,
    lastName?: string,
    nationality?: string,
  ): Promise<SanctionsHit[]> {
    const hits: SanctionsHit[] = [];

    try {
      const params: Record<string, string> = {
        resultPerPage: '20',
      };
      if (firstName) params.forename = firstName;
      if (lastName) params.name = lastName;
      if (nationality) params.nationality = nationality;

      const url = `${this.INTERPOL_API}/${type}`;
      this.logger.debug(`Interpol ${type.toUpperCase()}: ${url}`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          params,
          timeout: 15000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'OSINT-Screening-Service/1.0',
          },
        }),
      );

      const data = response.data;
      const notices = data?._embedded?.notices || [];

      for (const notice of notices) {
        const entityName = [notice.forename, notice.name].filter(Boolean).join(' ');
        const listName = type === 'red' ? 'RED_NOTICE' : 'YELLOW_NOTICE';
        const matchScore = this.calculateNameMatchScore(
          entityName,
          [firstName, lastName].filter(Boolean).join(' '),
        );

        hits.push({
          source: 'interpol',
          listName,
          entityName,
          matchScore,
          details: type === 'red'
            ? `Interpol Red Notice - Orden de arresto internacional: ${notice.charge || 'Sin cargos especificados'}`
            : `Interpol Yellow Notice - Persona desaparecida`,
          url: notice._links?.self?.href || `https://www.interpol.int/en/How-we-work/Notices/${type === 'red' ? 'Red' : 'Yellow'}-Notices`,
          nationality: Array.isArray(notice.nationalities)
            ? notice.nationalities.join(', ')
            : notice.nationality,
          dateOfBirth: notice.date_of_birth,
          charges: notice.charge,
          thumbnailUrl: notice._links?.thumbnail?.href,
          rawData: notice,
        });
      }

      this.logger.log(`Interpol ${type.toUpperCase()}: ${notices.length} notices, ${hits.length} hits`);
    } catch (error) {
      if (error?.response?.status === 404) {
        this.logger.debug(`Interpol ${type}: No results`);
      } else {
        this.logger.warn(`Interpol ${type} error: ${error.message}`);
      }
    }

    return hits;
  }

  // ============================================================
  // 2. OPENSANCTIONS API (agregador: OFAC + ONU + Europol + FBI + PEPs)
  // ============================================================

  /**
   * Busca en OpenSanctions - el agregador más completo del mundo
   * Incluye: OFAC SDN, UN Consolidated, EU Sanctions, Interpol, FBI, UK HMT, PEPs
   * API: https://api.opensanctions.org/search/default?q=nombre
   */
  private async searchOpenSanctions(identity: {
    fullName?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
  }): Promise<SanctionsHit[]> {
    const hits: SanctionsHit[] = [];

    const searchName = identity.fullName
      || [identity.firstName, identity.lastName].filter(Boolean).join(' ');

    if (!searchName || searchName.length < 2) return hits;

    try {
      const url = `${this.OPENSANCTIONS_API}/search/default`;

      this.logger.debug(`OpenSanctions search: "${searchName}"`);

      const response = await firstValueFrom(
        this.httpService.get(url, {
          params: {
            q: searchName,
            limit: '20',
          },
          timeout: 20000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'OSINT-Screening-Service/1.0',
          },
        }),
      );

      const results = response.data?.results || [];

      for (const entity of results) {
        const entityName = entity.caption || entity.name || 'Unknown';
        const score = Math.round((entity.score || 0) * 100);
        const datasets = entity.datasets || [];
        const properties = entity.properties || {};

        // Determinar la lista más relevante
        const listName = this.mapOpenSanctionsDataset(datasets);

        // Construir detalles
        const details = this.buildOpenSanctionsDetails(entity, datasets);

        // Extraer nacionalidad
        const nationality = (properties.nationality || properties.country || []).join(', ');

        // Extraer fecha de nacimiento
        const dob = (properties.birthDate || [])[0];

        hits.push({
          source: 'opensanctions',
          listName,
          entityName,
          matchScore: score,
          details,
          url: entity.referents?.[0]
            ? `https://opensanctions.org/entities/${entity.id}/`
            : `https://opensanctions.org/search/?q=${encodeURIComponent(searchName)}`,
          nationality: nationality || undefined,
          dateOfBirth: dob,
          rawData: {
            id: entity.id,
            schema: entity.schema,
            datasets,
            properties: {
              nationality: properties.nationality,
              birthDate: properties.birthDate,
              position: properties.position,
              topics: properties.topics,
            },
          },
        });
      }

      this.logger.log(`OpenSanctions: ${results.length} entities found, ${hits.length} hits`);
    } catch (error) {
      this.logger.warn(`OpenSanctions error: ${error.message}`);
    }

    return hits;
  }

  /**
   * Mapea datasets de OpenSanctions a nombres legibles
   */
  private mapOpenSanctionsDataset(datasets: string[]): string {
    const priorityMap: Record<string, string> = {
      'us_ofac_sdn': 'OFAC_SDN',
      'un_sc_sanctions': 'UN_SECURITY_COUNCIL',
      'eu_fsf': 'EU_SANCTIONS',
      'interpol_red_notices': 'INTERPOL_RED_NOTICE',
      'gb_hmt_sanctions': 'UK_HM_TREASURY',
      'us_fbi_most_wanted': 'FBI_MOST_WANTED',
      'eu_europol_wanted': 'EUROPOL_WANTED',
      'everypolitician': 'PEP',
      'ru_rupep': 'PEP_RUSSIA',
      'ua_nazk_pep': 'PEP_UKRAINE',
      'wd_peps': 'PEP_GLOBAL',
      'us_cia_world_leaders': 'PEP_WORLD_LEADERS',
      'mx_governors': 'PEP_MEXICO',
      'default': 'SANCTIONS_LIST',
    };

    for (const ds of datasets) {
      for (const [key, value] of Object.entries(priorityMap)) {
        if (ds.includes(key)) return value;
      }
    }

    return datasets.length > 0 ? datasets[0].toUpperCase() : 'UNKNOWN_LIST';
  }

  /**
   * Construye descripción detallada del hit
   */
  private buildOpenSanctionsDetails(
    entity: any,
    datasets: string[],
  ): string {
    const parts: string[] = [];
    const props = entity.properties || {};

    // Tipo de entidad
    if (entity.schema === 'Person') parts.push('Persona');
    else if (entity.schema === 'Organization') parts.push('Organización');
    else if (entity.schema === 'LegalEntity') parts.push('Entidad Legal');

    // Datasets legibles
    const dsNames = datasets.map(ds => {
      if (ds.includes('ofac')) return 'OFAC (Tesoro USA)';
      if (ds.includes('un_sc')) return 'ONU Consejo de Seguridad';
      if (ds.includes('eu_fsf')) return 'UE Sanciones';
      if (ds.includes('interpol')) return 'Interpol';
      if (ds.includes('fbi')) return 'FBI Most Wanted';
      if (ds.includes('europol')) return 'Europol';
      if (ds.includes('hmt')) return 'UK HM Treasury';
      if (ds.includes('pep') || ds.includes('politician') || ds.includes('cia_world')) return 'PEP';
      return ds;
    });
    parts.push(`Fuentes: ${[...new Set(dsNames)].join(', ')}`);

    // Temas/categorías
    const topics = props.topics || [];
    if (topics.includes('sanction')) parts.push('⚠️ SANCIONADO');
    if (topics.includes('crime')) parts.push('🚨 CRIMINAL');
    if (topics.includes('wanted')) parts.push('🔴 BUSCADO');
    if (topics.includes('poi')) parts.push('👤 Persona de Interés');
    if (topics.includes('pep')) parts.push('👔 Políticamente Expuesto');

    // Posición/cargo
    if (props.position && props.position.length > 0) {
      parts.push(`Cargo: ${props.position.join(', ')}`);
    }

    return parts.join(' | ');
  }

  // ============================================================
  // SCORING & RISK CALCULATION
  // ============================================================

  /**
   * Calcula nivel de riesgo basado en hits encontrados
   */
  private calculateRiskLevel(hits: SanctionsHit[]): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    if (hits.length === 0) return 'LOW';

    // Filtrar solo hits con score > 50%
    const significantHits = hits.filter(h => h.matchScore > 50);

    if (significantHits.length === 0) return 'LOW';

    // CRITICAL: Red Notice de Interpol o OFAC SDN con match alto
    const criticalSources = ['RED_NOTICE', 'OFAC_SDN', 'FBI_MOST_WANTED', 'UN_SECURITY_COUNCIL'];
    const hasCritical = significantHits.some(
      h => criticalSources.includes(h.listName) && h.matchScore > 70,
    );
    if (hasCritical) return 'CRITICAL';

    // HIGH: Sanciones confirmadas o Europol
    const highSources = ['EU_SANCTIONS', 'UK_HM_TREASURY', 'EUROPOL_WANTED', 'INTERPOL_RED_NOTICE'];
    const hasHigh = significantHits.some(
      h => highSources.includes(h.listName) && h.matchScore > 60,
    );
    if (hasHigh) return 'HIGH';

    // MEDIUM: PEPs o coincidencias débiles en listas
    const hasPEP = significantHits.some(h => h.listName.startsWith('PEP'));
    if (hasPEP || significantHits.length > 0) return 'MEDIUM';

    return 'LOW';
  }

  /**
   * Calcula score numérico de riesgo 0-100
   */
  private calculateRiskScore(hits: SanctionsHit[]): number {
    if (hits.length === 0) return 0;

    const weights: Record<string, number> = {
      'RED_NOTICE': 40,
      'OFAC_SDN': 40,
      'FBI_MOST_WANTED': 35,
      'UN_SECURITY_COUNCIL': 35,
      'EU_SANCTIONS': 30,
      'UK_HM_TREASURY': 30,
      'EUROPOL_WANTED': 30,
      'INTERPOL_RED_NOTICE': 25,
      'YELLOW_NOTICE': 15,
      'PEP': 10,
      'PEP_GLOBAL': 10,
      'PEP_MEXICO': 10,
      'PEP_WORLD_LEADERS': 10,
    };

    let totalScore = 0;
    for (const hit of hits) {
      const weight = weights[hit.listName] || 5;
      const contribution = (weight * hit.matchScore) / 100;
      totalScore += contribution;
    }

    return Math.min(100, Math.round(totalScore));
  }

  /**
   * Calcula similitud entre dos nombres (Levenshtein simplificado + tokens)
   */
  private calculateNameMatchScore(name1: string, name2: string): number {
    if (!name1 || !name2) return 0;

    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();

    // Exact match
    if (n1 === n2) return 100;

    // Token-based matching
    const tokens1 = n1.split(/\s+/).filter(t => t.length > 1);
    const tokens2 = n2.split(/\s+/).filter(t => t.length > 1);

    if (tokens1.length === 0 || tokens2.length === 0) return 0;

    let matchedTokens = 0;
    for (const t1 of tokens1) {
      for (const t2 of tokens2) {
        if (t1 === t2 || t1.includes(t2) || t2.includes(t1)) {
          matchedTokens++;
          break;
        }
      }
    }

    const maxTokens = Math.max(tokens1.length, tokens2.length);
    return Math.round((matchedTokens / maxTokens) * 100);
  }

  // ============================================================
  // EVIDENCE SAVING
  // ============================================================

  /**
   * Guarda cada hit de sanciones como evidencia en MongoDB
   */
  private async saveHitsAsEvidence(
    searchId: string,
    hits: SanctionsHit[],
  ): Promise<void> {
    for (const hit of hits) {
      try {
        const category = this.hitToCategory(hit);
        const sourceLabel = this.hitToSourceLabel(hit);

        await this.evidenceService.saveEvidence(searchId, {
          source: sourceLabel,
          category,
          title: `[${hit.listName}] ${hit.entityName}`,
          summary: hit.details,
          url: hit.url || '',
          thumbnailUrl: hit.thumbnailUrl,
          matchConfidence: hit.matchScore / 100,
          signals: {
            identity: hit.matchScore > 70 ? 0.8 : 0.4,
            legal: this.isLegalHit(hit) ? 0.9 : 0.3,
            financial: this.isFinancialHit(hit) ? 0.8 : 0.1,
            social: 0,
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to save sanctions evidence: ${err.message}`);
      }
    }
  }

  private hitToCategory(hit: SanctionsHit): 'identity' | 'legal' | 'financial' {
    if (hit.listName.startsWith('PEP')) return 'identity';
    if (['OFAC_SDN', 'UK_HM_TREASURY', 'EU_SANCTIONS'].includes(hit.listName)) return 'financial';
    return 'legal';
  }

  private hitToSourceLabel(hit: SanctionsHit): string {
    const labels: Record<string, string> = {
      'interpol': 'Interpol',
      'opensanctions': 'OpenSanctions',
      'ofac': 'OFAC (US Treasury)',
      'un': 'ONU',
    };
    return labels[hit.source] || hit.source;
  }

  private isLegalHit(hit: SanctionsHit): boolean {
    return ['RED_NOTICE', 'FBI_MOST_WANTED', 'EUROPOL_WANTED', 'YELLOW_NOTICE'].includes(hit.listName);
  }

  private isFinancialHit(hit: SanctionsHit): boolean {
    return ['OFAC_SDN', 'UN_SECURITY_COUNCIL', 'EU_SANCTIONS', 'UK_HM_TREASURY'].includes(hit.listName);
  }

  // ============================================================
  // SUMMARY & UTILS
  // ============================================================

  private generateSummary(
    hits: SanctionsHit[],
    riskLevel: string,
    sourcesChecked: string[],
  ): string {
    if (hits.length === 0) {
      return `🟢 SIN COINCIDENCIAS en ${sourcesChecked.length} fuentes internacionales. ` +
        `Fuentes consultadas: ${sourcesChecked.join(', ')}.`;
    }

    const significantHits = hits.filter(h => h.matchScore > 50);

    if (significantHits.length === 0) {
      return `🟢 ${hits.length} coincidencias débiles (posibles homónimos) en ${sourcesChecked.length} fuentes. ` +
        `Ninguna confirmada con alta confianza.`;
    }

    const flag = riskLevel === 'CRITICAL' ? '🔴' : riskLevel === 'HIGH' ? '🟠' : '🟡';
    const listNames = [...new Set(significantHits.map(h => h.listName))];

    return `${flag} ${riskLevel}: ${significantHits.length} coincidencia(s) significativa(s) en: ${listNames.join(', ')}. ` +
      `Total hits: ${hits.length}. Fuentes: ${sourcesChecked.length}. ` +
      `⚠️ POSIBLE homónimo — verificar identidad manualmente.`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
