import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EvidenceService } from './evidence.service';
import { InputOrchestratorService } from './input-orchestrator.service';
import { GroqIdentificationService } from './groq-identification.service';
import { ClusteringService } from './clustering.service';
import type { EvidenceDocument } from '../schemas/evidence.schema';
import type { IdentityClusterDocument } from '../schemas/identity-cluster.schema';

export interface HypothesisItem {
  id: string;
  title: string;
  confidence: number;
  rationale: string;
  riskLevel: 'low' | 'medium' | 'high';
  supportingEvidenceIds: string[];
  conflictingEvidenceIds: string[];
  nextActions: string[];
}

export interface SearchHypothesesResponse {
  searchId: string;
  query: string;
  generatedAt: string;
  status: 'ok' | 'degraded';
  model: 'groq-assisted' | 'heuristic-fallback';
  evidenceAnalyzed: number;
  warning?: string;
  positiveInsights?: PositiveCorrelationInsights;
  hypotheses: HypothesisItem[];
}

export interface PositiveCorrelationInsights {
  validatedEvidenceCount: number;
  descriptiveSignals: string[];
  personDescriptors: string[];
  relatedEntities: {
    aliases: string[];
    emails: string[];
    phones: string[];
    domains: string[];
    organizations: string[];
    platforms: string[];
  };
  profileCards: Array<{
    evidenceId: string;
    source: string;
    title: string;
    summary: string;
    url?: string;
    imageUrl?: string;
    reliability: number;
  }>;
  suggestedQueries: string[];
}

export interface HypothesisHints {
  targetIdentity?: string;
  aliases?: string[];
  organizations?: string[];
  notes?: string;
}

@Injectable()
export class HypothesisEngineService {
  private readonly logger = new Logger(HypothesisEngineService.name);

  constructor(
    private readonly evidenceService: EvidenceService,
    private readonly inputOrchestrator: InputOrchestratorService,
    private readonly groqIdentification: GroqIdentificationService,
    private readonly clusteringService: ClusteringService,
  ) {}

  async generateForSearch(searchId: string, hints?: HypothesisHints): Promise<SearchHypothesesResponse> {
    const search = await this.inputOrchestrator.getSearchById(searchId);
    if (!search) {
      throw new NotFoundException(`Search ${searchId} not found`);
    }

    const searchEvidences = await this.evidenceService.getEvidenceBySearch(searchId);
    if (!searchEvidences.length) {
      return {
        searchId,
        query: search.query || '',
        generatedAt: new Date().toISOString(),
        status: 'degraded',
        model: 'heuristic-fallback',
        evidenceAnalyzed: 0,
        warning: 'No hay evidencias para generar hipótesis.',
        hypotheses: [],
      };
    }

    const cluster = await this.resolveCluster(search as any);
    const clusterEvidences = await this.getClusterEvidences(cluster, searchId);
    const allEvidences = this.mergeEvidence(searchEvidences, clusterEvidences);

    const falsePositives = allEvidences.filter((e) => e.validationStatus === 'false_positive');
    const usableEvidences = allEvidences.filter((e) => e.validationStatus !== 'false_positive');
    const enrichedEvidencePool = usableEvidences.length > 0 ? usableEvidences : allEvidences;

    if (!enrichedEvidencePool.length) {
      return {
        searchId,
        query: search.query || '',
        generatedAt: new Date().toISOString(),
        status: 'degraded',
        model: 'heuristic-fallback',
        evidenceAnalyzed: 0,
        warning: 'No hay evidencias utilizables para generar hipótesis.',
        hypotheses: [],
      };
    }

    const topEvidences = enrichedEvidencePool
      .sort((a, b) => this.sortForHypotheses(a, b))
      .slice(0, 40);
    const automaticHints = this.buildAutomaticHints(search as any, cluster, topEvidences);
    const normalizedHints = this.normalizeHints({ ...automaticHints, ...(hints || {}) });

    let aiNames: string[] = [];
    let model: SearchHypothesesResponse['model'] = 'heuristic-fallback';
    let status: SearchHypothesesResponse['status'] = 'ok';
    let warning: string | undefined;

    try {
      const corpus = topEvidences
        .map((e) => `${e.title || ''}. ${e.summary || ''}`)
        .join('\n');
      aiNames = (await this.groqIdentification.extractNames(corpus)).slice(0, 6);
      model = 'groq-assisted';
    } catch (error: any) {
      status = 'degraded';
      warning = error?.message || 'No se pudo enriquecer con IA';
      this.logger.warn(`Hypotheses AI enrichment failed: ${warning}`);
    }

    const positiveInsights = this.extractPositiveCorrelationInsights(
      topEvidences.filter((e) => e.validationStatus === 'valid'),
      normalizedHints,
      String(search.query || ''),
    );

    const hypotheses = this.buildHypotheses(
      topEvidences,
      aiNames,
      normalizedHints,
      falsePositives,
      positiveInsights,
    );

    return {
      searchId,
      query: search.query || '',
      generatedAt: new Date().toISOString(),
      status,
      model,
      evidenceAnalyzed: topEvidences.length + falsePositives.length,
      warning,
      positiveInsights,
      hypotheses,
    };
  }

  private buildHypotheses(
    evidences: EvidenceDocument[],
    aiNames: string[],
    hints: HypothesisHints,
    falsePositiveEvidencesInput: EvidenceDocument[] = [],
    positiveInsights?: PositiveCorrelationInsights,
  ): HypothesisItem[] {
    const hypotheses: HypothesisItem[] = [];

    const falsePositiveEvidences = falsePositiveEvidencesInput.length
      ? falsePositiveEvidencesInput
      : evidences.filter((e) => e.validationStatus === 'false_positive');
    const usableEvidences = evidences.filter((e) => e.validationStatus !== 'false_positive');
    const pendingEvidences = usableEvidences.filter((e) => e.validationStatus === 'pending');
    const validEvidences = usableEvidences.filter((e) => e.validationStatus === 'valid');
    const validationDenominator = Math.max(1, validEvidences.length + falsePositiveEvidences.length);
    const validatedPrecision = validEvidences.length / validationDenominator;

    const ranked = usableEvidences
      .map((e) => ({ evidence: e, weighted: this.scoreEvidence(e, hints) }))
      .sort((a, b) => b.weighted - a.weighted);

    const topRanked = ranked.map((item) => item.evidence);
    const highReliability = topRanked.filter((e) => (e.reliability || 0) >= 0.75);
    const legalSignals = topRanked.filter((e) => (e.signals?.legal || 0) > 0);
    const financialSignals = topRanked.filter((e) => (e.signals?.financial || 0) > 0);
    const socialSources = topRanked.filter((e) => {
      const source = (e.source || '').toLowerCase();
      return source.includes('instagram') || source.includes('facebook') || source.includes('twitter') || source.includes('linkedin') || source.includes('tiktok');
    });
    const falsePositives = falsePositiveEvidences.length;
    const pending = pendingEvidences.length;

    const hintAliases = hints.aliases || [];
    const hintOrgs = hints.organizations || [];
    const anchorSupport = this.getTopEvidenceIds(validEvidences.length ? validEvidences : highReliability, 8);
    const topConflict = this.getTopEvidenceIds(falsePositiveEvidences, 6);

    if (validEvidences.length >= 3) {
      hypotheses.push({
        id: 'validated-identity-anchor',
        title: 'Identidad anclada en evidencia manualmente validada',
        confidence: this.clamp(0.64 + validEvidences.length * 0.045 + validatedPrecision * 0.2),
        rationale: `Se validaron ${validEvidences.length} evidencias con precisión manual del ${Math.round(validatedPrecision * 100)}%, lo que aumenta la certeza sobre la identidad objetivo.`,
        riskLevel: validatedPrecision >= 0.7 ? 'low' : 'medium',
        supportingEvidenceIds: anchorSupport,
        conflictingEvidenceIds: topConflict,
        nextActions: [
          'Priorizar nuevas búsquedas usando solo entidades derivadas de evidencias validadas',
          'Expandir correlación temporal y geográfica con los hallazgos validados',
          ...(positiveInsights?.suggestedQueries || []).slice(0, 2).map((query) => `Ejecutar búsqueda dirigida: ${query}`),
        ],
      });
    }

    if (validEvidences.length >= 2 && positiveInsights && positiveInsights.suggestedQueries.length > 0) {
      hypotheses.push({
        id: 'validated-correlation-map',
        title: 'Correlación de evidencias positivas para expansión investigativa',
        confidence: this.clamp(0.58 + validEvidences.length * 0.03),
        rationale: positiveInsights.descriptiveSignals.length > 0
          ? `Las evidencias validadas muestran patrones consistentes: ${positiveInsights.descriptiveSignals.slice(0, 3).join(' | ')}`
          : 'Las evidencias validadas comparten entidades repetidas útiles para expandir la investigación.',
        riskLevel: 'low',
        supportingEvidenceIds: this.getTopEvidenceIds(validEvidences, 8),
        conflictingEvidenceIds: this.getTopEvidenceIds(falsePositiveEvidences, 4),
        nextActions: positiveInsights.suggestedQueries
          .slice(0, 4)
          .map((query) => `Nueva búsqueda sugerida: ${query}`),
      });
    }

    if (highReliability.length >= 3) {
      hypotheses.push({
        id: 'identity-consistency',
        title: 'Identidad con señales consistentes entre múltiples fuentes',
        confidence: this.clamp(0.5 + highReliability.length * 0.02 + validEvidences.length * 0.03),
        rationale: validEvidences.length > 0
          ? 'Las evidencias de alta confiabilidad se refuerzan con validaciones manuales positivas.'
          : 'Se detectaron varias evidencias de alta confiabilidad que apuntan al mismo sujeto investigado.',
        riskLevel: 'medium',
        supportingEvidenceIds: this.getTopEvidenceIds(validEvidences.length ? validEvidences : highReliability, 8),
        conflictingEvidenceIds: topConflict,
        nextActions: [
          'Validar manualmente 3 evidencias con mayor reliability',
          'Cruzar dominios y fechas para confirmar continuidad temporal',
        ],
      });
    }

    if (socialSources.length >= 2) {
      hypotheses.push({
        id: 'social-footprint',
        title: 'Huella digital activa en redes sociales',
        confidence: this.clamp(0.48 + socialSources.length * 0.025 + validEvidences.length * 0.02),
        rationale: 'Aparecen referencias repetidas en fuentes sociales que sugieren actividad digital del objetivo.',
        riskLevel: 'low',
        supportingEvidenceIds: this.getTopEvidenceIds(socialSources, 8),
        conflictingEvidenceIds: topConflict,
        nextActions: [
          'Priorizar perfiles con mayor matchConfidence',
          'Verificar correlación de usernames y alias en cada plataforma',
        ],
      });
    }

    if (legalSignals.length > 0) {
      hypotheses.push({
        id: 'legal-exposure',
        title: 'Posible exposición legal o litigiosa',
        confidence: this.clamp(0.46 + legalSignals.length * 0.035 + validEvidences.length * 0.015),
        rationale: 'Existen señales legales detectadas en títulos o resúmenes que requieren confirmación documental.',
        riskLevel: 'high',
        supportingEvidenceIds: this.getTopEvidenceIds(legalSignals, 8),
        conflictingEvidenceIds: topConflict,
        nextActions: [
          'Solicitar evidencia primaria (documentos oficiales o boletines)',
          'Separar menciones periodísticas de registros oficiales',
        ],
      });
    }

    if (financialSignals.length > 0) {
      hypotheses.push({
        id: 'financial-linkage',
        title: 'Vinculación financiera u organizacional potencial',
        confidence: this.clamp(0.45 + financialSignals.length * 0.03 + hintOrgs.length * 0.03),
        rationale: 'Se observaron señales financieras que podrían indicar actividad empresarial o de representación.',
        riskLevel: 'medium',
        supportingEvidenceIds: this.getTopEvidenceIds(financialSignals, 8),
        conflictingEvidenceIds: topConflict,
        nextActions: [
          'Confirmar RFC/CURP/razón social en fuentes oficiales',
          'Verificar temporalidad de los vínculos hallados',
        ],
      });
    }

    if (hintAliases.length > 0 || hintOrgs.length > 0 || hints.targetIdentity || hints.notes) {
      const hintDriven = topRanked.filter((e) => this.hintMatchScore(e, hints) >= 0.2);
      hypotheses.push({
        id: 'investigator-guided-focus',
        title: 'Línea guiada por hipótesis del investigador',
        confidence: this.clamp(0.5 + hintDriven.length * 0.03 + validEvidences.length * 0.02),
        rationale: this.buildHintRationale(hints, hintDriven.length),
        riskLevel: 'medium',
        supportingEvidenceIds: this.getTopEvidenceIds(hintDriven.length ? hintDriven : topRanked, 8),
        conflictingEvidenceIds: topConflict,
        nextActions: [
          'Refinar consulta base incorporando alias y organización prioritaria',
          'Separar resultados consistentes con las pistas manuales de los no consistentes',
        ],
      });
    }

    if (aiNames.length > 0) {
      hypotheses.push({
        id: 'ai-alias-candidates',
        title: 'Alias o variaciones de nombre detectadas por IA',
        confidence: this.clamp(0.45 + aiNames.length * 0.05),
        rationale: `La IA extrajo posibles nombres relacionados: ${aiNames.join(', ')}.`,
        riskLevel: 'low',
        supportingEvidenceIds: this.getTopEvidenceIds(validEvidences.length ? validEvidences : highReliability, 5),
        conflictingEvidenceIds: topConflict,
        nextActions: [
          'Re-ejecutar búsqueda con cada alias sugerido',
          'Comparar alias contra perfiles sociales y menciones de prensa',
        ],
      });
    }

    if (falsePositives > 0) {
      hypotheses.push({
        id: 'false-positive-noise',
        title: 'Riesgo de ruido o homonimias en los resultados',
        confidence: this.clamp(0.35 + falsePositives / Math.max(1, evidences.length) + (1 - validatedPrecision) * 0.15),
        rationale: `Se registran ${falsePositives} evidencias marcadas como falso positivo y ${pending} aún pendientes de validación.`,
        riskLevel: 'medium',
        supportingEvidenceIds: this.getTopEvidenceIds(falsePositiveEvidences, 8),
        conflictingEvidenceIds: this.getTopEvidenceIds(validEvidences.length ? validEvidences : highReliability, 4),
        nextActions: [
          'Aplicar filtros por geografía, fecha y contexto profesional',
          'Priorizar fuentes oficiales para reducir ambiguedad',
        ],
      });
    }

    if (!hypotheses.length) {
      hypotheses.push({
        id: 'insufficient-evidence',
        title: 'Evidencia insuficiente para inferencias sólidas',
        confidence: 0.3,
        rationale: 'Hay pocos hallazgos consistentes para construir hipótesis robustas.',
        riskLevel: 'low',
        supportingEvidenceIds: usableEvidences.slice(0, 5).map((e) => e.evidenceId),
        conflictingEvidenceIds: [],
        nextActions: [
          'Ejecutar búsqueda adicional con mayor profundidad',
          'Agregar más señales de identidad (alias, ubicación, organización)',
        ],
      });
    }

    return hypotheses
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 6)
      .map((item, index) => ({ ...item, id: `${item.id}-${index + 1}` }));
  }

  private normalizeHints(hints?: HypothesisHints): HypothesisHints {
    if (!hints) {
      return {};
    }

    return {
      targetIdentity: hints.targetIdentity?.trim() || undefined,
      notes: hints.notes?.trim() || undefined,
      aliases: (hints.aliases || []).map((item) => item.trim()).filter(Boolean),
      organizations: (hints.organizations || []).map((item) => item.trim()).filter(Boolean),
    };
  }

  private scoreEvidence(evidence: EvidenceDocument, hints: HypothesisHints): number {
    const reliability = evidence.reliability || 0;
    const matchConfidence = evidence.matchConfidence || 0;
    const legal = evidence.signals?.legal || 0;
    const financial = evidence.signals?.financial || 0;
    const social = evidence.signals?.social || 0;
    const signalStrength = Math.min(1, (legal + financial + social) / 3);

    const baseScore = reliability * 0.55 + matchConfidence * 0.25 + signalStrength * 0.2;
    let validationFactor = 1;
    if (evidence.validationStatus === 'valid') {
      validationFactor = 1.7;
    } else if (evidence.validationStatus === 'false_positive') {
      validationFactor = 0.35;
    }

    const hintBoost = this.hintMatchScore(evidence, hints);
    return this.clamp(baseScore * validationFactor + hintBoost);
  }

  private hintMatchScore(evidence: EvidenceDocument, hints: HypothesisHints): number {
    const bag = this.evidenceTextBag(evidence);
    let score = 0;

    if (hints.targetIdentity && bag.includes(hints.targetIdentity.toLowerCase())) {
      score += 0.22;
    }

    for (const alias of hints.aliases || []) {
      if (alias && bag.includes(alias.toLowerCase())) {
        score += 0.14;
      }
    }

    for (const org of hints.organizations || []) {
      if (org && bag.includes(org.toLowerCase())) {
        score += 0.12;
      }
    }

    if (hints.notes) {
      const noteTokens = hints.notes
        .toLowerCase()
        .split(/[,;\s]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4)
        .slice(0, 8);

      for (const token of noteTokens) {
        if (bag.includes(token)) {
          score += 0.03;
        }
      }
    }

    return Math.min(0.35, score);
  }

  private evidenceTextBag(evidence: EvidenceDocument): string {
    const extractedData = evidence.extractedData ? JSON.stringify(evidence.extractedData) : '';
    return [
      evidence.title || '',
      evidence.summary || '',
      evidence.source || '',
      evidence.category || '',
      evidence.url || '',
      extractedData,
    ]
      .join(' ')
      .toLowerCase();
  }

  private getTopEvidenceIds(evidences: EvidenceDocument[], limit: number): string[] {
    return evidences.slice(0, limit).map((e) => e.evidenceId);
  }

  private buildHintRationale(hints: HypothesisHints, matched: number): string {
    const parts: string[] = [];
    if (hints.targetIdentity) {
      parts.push(`identidad objetivo "${hints.targetIdentity}"`);
    }
    if ((hints.aliases || []).length > 0) {
      parts.push(`${hints.aliases?.length} alias`);
    }
    if ((hints.organizations || []).length > 0) {
      parts.push(`${hints.organizations?.length} organización(es)`);
    }

    const base = parts.length > 0
      ? `Se incorporaron pistas manuales (${parts.join(', ')}) y ${matched} evidencias muestran correlación directa.`
      : `Se incorporaron notas manuales y ${matched} evidencias muestran correlación directa.`;

    return hints.notes ? `${base} Nota del analista considerada en el ranking.` : base;
  }

  private extractPositiveCorrelationInsights(
    validEvidences: EvidenceDocument[],
    hints: HypothesisHints,
    query: string,
  ): PositiveCorrelationInsights {
    const aliases = new Set<string>((hints.aliases || []).map((item) => item.toLowerCase()));
    const emails = new Set<string>();
    const phones = new Set<string>();
    const domains = new Set<string>();
    const organizations = new Set<string>((hints.organizations || []).map((item) => item.toLowerCase()));
    const platforms = new Set<string>();
    const descriptiveSignals = new Set<string>();
    const personDescriptors = new Set<string>();
    const profileCards: PositiveCorrelationInsights['profileCards'] = [];

    for (const evidence of validEvidences) {
      const source = (evidence.source || '').toLowerCase();
      if (source) {
        platforms.add(source);
      }

      const title = evidence.title || '';
      const summary = evidence.summary || '';
      const bag = `${title} ${summary}`.toLowerCase();
      if (title) descriptiveSignals.add(`Titulo recurrente: ${title.slice(0, 80)}`);

      if (profileCards.length < 6) {
        profileCards.push({
          evidenceId: evidence.evidenceId,
          source: evidence.source,
          title: title || 'Perfil validado',
          summary: (summary || '').slice(0, 220),
          url: evidence.url,
          imageUrl: evidence.thumbnailUrl || evidence.imageUrl,
          reliability: Number((evidence.reliability || 0).toFixed(2)),
        });
      }

      const extracted = (evidence.extractedData || {}) as Record<string, any>;
      for (const [key, value] of Object.entries(extracted)) {
        if (!value) continue;
        const lowerKey = String(key).toLowerCase();
        if (['name', 'nombre', 'full_name', 'fullname', 'location', 'ciudad', 'pais', 'position', 'cargo'].includes(lowerKey)) {
          personDescriptors.add(`${key}: ${String(value).slice(0, 80)}`);
        }
      }

      for (const email of (extracted.emails || []) as string[]) {
        const normalized = String(email).toLowerCase().trim();
        if (!normalized) continue;
        emails.add(normalized);
        const [, domain] = normalized.split('@');
        if (domain) domains.add(domain);
      }

      for (const phone of (extracted.phones || []) as string[]) {
        const normalized = String(phone).replace(/\s+/g, '').trim();
        if (normalized) phones.add(normalized);
      }

      const url = evidence.url || '';
      const handleMatch = url.match(/@([A-Za-z0-9._-]{3,30})/);
      if (handleMatch?.[1]) aliases.add(`@${handleMatch[1].toLowerCase()}`);

      const profilePath = url.match(/\/(?:in|u|user|profile)\/([A-Za-z0-9._-]{3,40})/i);
      if (profilePath?.[1]) aliases.add(profilePath[1].toLowerCase());

      const orgCandidates = [
        extracted.organization,
        extracted.organizacion,
        extracted.company,
        extracted.employer,
        extracted.workplace,
      ];
      for (const org of orgCandidates) {
        if (org) organizations.add(String(org).toLowerCase().trim());
      }

      if (source.includes('linkedin')) {
        const linkedinOrg = title.match(/at\s+([^|,]+)/i) || summary.match(/at\s+([^|,]+)/i);
        if (linkedinOrg?.[1]) organizations.add(linkedinOrg[1].toLowerCase().trim());
      }

      const personPattern = title.match(/([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/);
      if (personPattern?.[1]) {
        personDescriptors.add(`Nombre detectado: ${personPattern[1]}`);
      }

      if (bag.includes('abogado')) descriptiveSignals.add('Perfil con señal legal/profesional (abogado)');
      if (bag.includes('ingenier')) descriptiveSignals.add('Perfil con señal técnica/ingeniería');
      if (bag.includes('director') || bag.includes('ceo')) descriptiveSignals.add('Perfil con rol ejecutivo/directivo');
      if (bag.includes('méxico') || bag.includes('mexico')) personDescriptors.add('Geografía detectada: México');
    }

    const baseIdentity = (hints.targetIdentity || query || '').trim();
    const suggestedQueries = this.buildSuggestedQueries({
      baseIdentity,
      aliases: [...aliases],
      emails: [...emails],
      phones: [...phones],
      domains: [...domains],
      organizations: [...organizations],
      platforms: [...platforms],
    });

    return {
      validatedEvidenceCount: validEvidences.length,
      descriptiveSignals: [...descriptiveSignals].slice(0, 6),
      personDescriptors: [...personDescriptors].slice(0, 8),
      relatedEntities: {
        aliases: [...aliases].slice(0, 12),
        emails: [...emails].slice(0, 10),
        phones: [...phones].slice(0, 8),
        domains: [...domains].slice(0, 8),
        organizations: [...organizations].slice(0, 10),
        platforms: [...platforms].slice(0, 8),
      },
      profileCards,
      suggestedQueries,
    };
  }

  private buildSuggestedQueries(data: {
    baseIdentity: string;
    aliases: string[];
    emails: string[];
    phones: string[];
    domains: string[];
    organizations: string[];
    platforms: string[];
  }): string[] {
    const querySet = new Set<string>();
    const base = data.baseIdentity || data.aliases[0] || '';

    for (const alias of data.aliases.slice(0, 4)) {
      if (base) querySet.add(`"${base}" "${alias}"`);
      querySet.add(`"${alias}"`);
    }

    for (const org of data.organizations.slice(0, 3)) {
      if (base) querySet.add(`"${base}" "${org}"`);
    }

    for (const email of data.emails.slice(0, 3)) {
      querySet.add(`"${email}"`);
    }

    for (const phone of data.phones.slice(0, 2)) {
      querySet.add(`"${phone}"`);
    }

    for (const domain of data.domains.slice(0, 3)) {
      if (base) querySet.add(`"${base}" site:${domain}`);
    }

    for (const platform of data.platforms.slice(0, 3)) {
      if (base) querySet.add(`"${base}" "${platform}"`);
    }

    return [...querySet].filter(Boolean).slice(0, 10);
  }

  private buildAutomaticHints(
    search: any,
    cluster: IdentityClusterDocument | null,
    evidences: EvidenceDocument[],
  ): HypothesisHints {
    const personalInfo = search?.inputData?.personalInfo || {};
    const context = search?.inputData?.context || {};

    const fullName = [personalInfo.nombre, personalInfo.apellido].filter(Boolean).join(' ').trim();
    const aliases = new Set<string>();
    const organizations = new Set<string>();
    const noteParts: string[] = [];

    if (personalInfo.username) aliases.add(String(personalInfo.username));
    if (personalInfo.alias) aliases.add(String(personalInfo.alias));
    if (fullName) aliases.add(fullName);
    if (personalInfo.email) aliases.add(String(personalInfo.email).split('@')[0]);
    if (context.organizacion) organizations.add(String(context.organizacion));

    if (cluster) {
      for (const a of cluster.aliases || []) aliases.add(a);
      if (cluster.fullName) aliases.add(cluster.fullName);
      if (cluster.displayName) aliases.add(cluster.displayName);
      if ((cluster.platforms || []).length) {
        noteParts.push(`Plataformas históricas del cluster: ${(cluster.platforms || []).join(', ')}`);
      }
    }

    const validEvidences = evidences.filter((e) => e.validationStatus === 'valid');
    for (const evidence of validEvidences.slice(0, 20)) {
      const source = (evidence.source || '').toLowerCase();
      const url = evidence.url || '';

      const handleMatch = url.match(/@([A-Za-z0-9._-]{3,30})/);
      if (handleMatch?.[1]) aliases.add(`@${handleMatch[1]}`);

      const pathMatch = url.match(/\/(?:in|u|user|profile)\/([A-Za-z0-9._-]{3,40})/i);
      if (pathMatch?.[1]) aliases.add(pathMatch[1]);

      const extracted = (evidence.extractedData || {}) as Record<string, any>;
      const orgCandidate =
        extracted.organization ||
        extracted.organizacion ||
        extracted.company ||
        extracted.employer ||
        extracted.workplace;
      if (orgCandidate) organizations.add(String(orgCandidate));

      if (source.includes('linkedin') && evidence.title) {
        const titleOrgMatch = evidence.title.match(/at\s+([^|,]+)/i);
        if (titleOrgMatch?.[1]) organizations.add(titleOrgMatch[1].trim());
      }
    }

    if (context.notas) {
      noteParts.push(String(context.notas));
    }

    if (validEvidences.length > 0) {
      noteParts.push(`Patrón validado por analista en ${validEvidences.length} evidencias.`);
    }

    return {
      targetIdentity: fullName || cluster?.fullName || search?.query || undefined,
      aliases: [...aliases].filter((item) => item && item.length >= 2).slice(0, 20),
      organizations: [...organizations].filter((item) => item && item.length >= 2).slice(0, 12),
      notes: noteParts.join(' | ').slice(0, 800) || undefined,
    };
  }

  private async resolveCluster(search: any): Promise<IdentityClusterDocument | null> {
    const clusterId = search?.metadata?.clusterId;
    if (!clusterId) {
      return null;
    }

    try {
      return await this.clusteringService.getClusterById(clusterId);
    } catch {
      return null;
    }
  }

  private async getClusterEvidences(
    cluster: IdentityClusterDocument | null,
    currentSearchId: string,
  ): Promise<EvidenceDocument[]> {
    if (!cluster?.searchIds?.length) {
      return [];
    }

    const searchIds = cluster.searchIds
      .filter((id) => id !== currentSearchId)
      .slice(-8);

    if (!searchIds.length) {
      return [];
    }

    const chunks = await Promise.allSettled(
      searchIds.map((id) => this.evidenceService.getEvidenceBySearch(id)),
    );

    return chunks
      .filter((item): item is PromiseFulfilledResult<EvidenceDocument[]> => item.status === 'fulfilled')
      .flatMap((item) => item.value || []);
  }

  private mergeEvidence(current: EvidenceDocument[], cluster: EvidenceDocument[]): EvidenceDocument[] {
    const map = new Map<string, EvidenceDocument>();
    for (const evidence of [...current, ...cluster]) {
      map.set(evidence.evidenceId, evidence);
    }
    return [...map.values()];
  }

  private sortForHypotheses(a: EvidenceDocument, b: EvidenceDocument): number {
    const valOrder = (e: EvidenceDocument): number => {
      if (e.validationStatus === 'valid') return 2;
      if (e.validationStatus === 'pending') return 1;
      return 0;
    };

    const byValidation = valOrder(b) - valOrder(a);
    if (byValidation !== 0) {
      return byValidation;
    }

    return (b.reliability || 0) - (a.reliability || 0);
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
  }
}
