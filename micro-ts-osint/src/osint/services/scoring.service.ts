import { Injectable, Logger } from '@nestjs/common';
import { EvidenceDocument } from '../schemas/evidence.schema';

/**
 * Multi-dimensional score result
 */
export interface MultiDimensionalScore {
  identity: number; // 0-100
  legal: number; // 0-100
  financial: number; // 0-100
  overall: number; // 0-100 (weighted average)
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reasons: {
    identity: string[];
    legal: string[];
    financial: string[];
  };
}

/**
 * Scoring Service - Multi-dimensional evidence scoring
 *
 * Scoring weights:
 * - Identity: 45%
 * - Legal: 35%
 * - Financial: 20%
 *
 * Confidence levels:
 * - HIGH: 85-100 (8+ sources, high reliability)
 * - MEDIUM: 60-84 (4-7 sources, medium reliability)
 * - LOW: <60 (<4 sources, low reliability)
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  /**
   * Calculate multi-dimensional scores from evidence
   */
  computeScores(evidences: EvidenceDocument[]): MultiDimensionalScore {
    this.logger.log(`Computing scores for ${evidences.length} evidence items`);

    const scores: MultiDimensionalScore = {
      identity: 0,
      legal: 0,
      financial: 0,
      overall: 0,
      confidence: 'LOW',
      reasons: {
        identity: [],
        legal: [],
        financial: [],
      },
    };

    if (evidences.length === 0) {
      return scores;
    }

    // Calculate scores for each dimension
    const identityData = this.calculateDimensionScore(
      evidences.filter((e) => e.category === 'identity'),
      'identity',
    );
    scores.identity = identityData.score;
    scores.reasons.identity = identityData.reasons;

    const legalData = this.calculateDimensionScore(
      evidences.filter((e) => e.category === 'legal'),
      'legal',
    );
    scores.legal = legalData.score;
    scores.reasons.legal = legalData.reasons;

    const financialData = this.calculateDimensionScore(
      evidences.filter((e) => e.category === 'financial'),
      'financial',
    );
    scores.financial = financialData.score;
    scores.reasons.financial = financialData.reasons;

    // Calculate weighted overall score
    // Identity: 45%, Legal: 35%, Financial: 20%
    scores.overall =
      scores.identity * 0.45 + scores.legal * 0.35 + scores.financial * 0.2;

    // Determine confidence level
    scores.confidence = this.determineConfidence(scores.overall, evidences);

    this.logger.log(
      `✅ Scores computed: Overall=${scores.overall.toFixed(2)}, Confidence=${scores.confidence}`,
    );

    return scores;
  }

  /**
   * Calculate score for a single dimension
   */
  private calculateDimensionScore(
    evidences: EvidenceDocument[],
    dimension: 'identity' | 'legal' | 'financial',
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];

    if (evidences.length === 0) {
      reasons.push('No evidence found');
      return { score: 0, reasons };
    }

    // Component 1: Evidence count (max 40 points)
    // Each evidence adds 4 points, capped at 40
    const countScore = Math.min(evidences.length * 4, 40);
    reasons.push(`${evidences.length} evidence items found`);

    // Component 2: Average reliability (max 30 points)
    const avgReliability = this.calculateAverageReliability(evidences);
    const reliabilityScore = avgReliability * 30;
    reasons.push(`Average reliability: ${(avgReliability * 100).toFixed(0)}%`);

    // Component 3: Source diversity (max 20 points)
    const uniqueSources = new Set(evidences.map((e) => e.source)).size;
    const diversityScore = Math.min(uniqueSources * 4, 20);
    reasons.push(`${uniqueSources} unique sources`);

    // Component 4: High-quality evidence (max 10 points)
    const highQualityCount = evidences.filter(
      (e) => e.reliability >= 0.8,
    ).length;
    const qualityScore = Math.min(highQualityCount * 2, 10);
    if (highQualityCount > 0) {
      reasons.push(`${highQualityCount} high-reliability sources`);
    }

    const totalScore =
      countScore + reliabilityScore + diversityScore + qualityScore;

    return {
      score: Math.min(totalScore, 100),
      reasons,
    };
  }

  /**
   * Calculate average reliability across evidence
   */
  private calculateAverageReliability(evidences: EvidenceDocument[]): number {
    if (evidences.length === 0) return 0;

    const sum = evidences.reduce((acc, e) => acc + e.reliability, 0);
    return sum / evidences.length;
  }

  /**
   * Determine confidence level based on overall score and evidence quality
   */
  private determineConfidence(
    overallScore: number,
    evidences: EvidenceDocument[],
  ): 'HIGH' | 'MEDIUM' | 'LOW' {
    // High confidence: 85+ score AND 8+ evidence items
    if (overallScore >= 85 && evidences.length >= 8) {
      return 'HIGH';
    }

    // Medium confidence: 60+ score AND 4+ evidence items
    if (overallScore >= 60 && evidences.length >= 4) {
      return 'MEDIUM';
    }

    // Low confidence: everything else
    return 'LOW';
  }

  /**
   * Get score breakdown with detailed analysis
   */
  getScoreBreakdown(evidences: EvidenceDocument[]): {
    scores: MultiDimensionalScore;
    breakdown: {
      totalEvidence: number;
      byCategory: Record<string, number>;
      bySource: Record<string, number>;
      averageReliability: number;
      highReliabilityCount: number;
      mediumReliabilityCount: number;
      lowReliabilityCount: number;
    };
  } {
    const scores = this.computeScores(evidences);

    // Count by category
    const byCategory: Record<string, number> = {};
    evidences.forEach((e) => {
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    });

    // Count by source
    const bySource: Record<string, number> = {};
    evidences.forEach((e) => {
      bySource[e.source] = (bySource[e.source] || 0) + 1;
    });

    // Reliability distribution
    const avgReliability = this.calculateAverageReliability(evidences);
    const highReliabilityCount = evidences.filter(
      (e) => e.reliability >= 0.8,
    ).length;
    const mediumReliabilityCount = evidences.filter(
      (e) => e.reliability >= 0.5 && e.reliability < 0.8,
    ).length;
    const lowReliabilityCount = evidences.filter(
      (e) => e.reliability < 0.5,
    ).length;

    return {
      scores,
      breakdown: {
        totalEvidence: evidences.length,
        byCategory,
        bySource,
        averageReliability: avgReliability,
        highReliabilityCount,
        mediumReliabilityCount,
        lowReliabilityCount,
      },
    };
  }

  /**
   * Compare two score results
   */
  compareScores(
    scoresA: MultiDimensionalScore,
    scoresB: MultiDimensionalScore,
  ): {
    improvement: number;
    improvedDimensions: string[];
    overallTrend: 'improved' | 'declined' | 'stable';
  } {
    const improvement = scoresB.overall - scoresA.overall;

    const improvedDimensions: string[] = [];
    if (scoresB.identity > scoresA.identity)
      improvedDimensions.push('identity');
    if (scoresB.legal > scoresA.legal) improvedDimensions.push('legal');
    if (scoresB.financial > scoresA.financial)
      improvedDimensions.push('financial');

    let overallTrend: 'improved' | 'declined' | 'stable' = 'stable';
    if (improvement > 5) overallTrend = 'improved';
    else if (improvement < -5) overallTrend = 'declined';

    return {
      improvement: Math.round(improvement * 100) / 100,
      improvedDimensions,
      overallTrend,
    };
  }

  /**
   * Get score description for frontend display
   */
  getScoreDescription(score: number): {
    label: string;
    color: string;
    emoji: string;
    description: string;
  } {
    if (score >= 85) {
      return {
        label: 'Excelente',
        color: '#10B981', // green
        emoji: '🟢',
        description: 'Alta confiabilidad con múltiples fuentes verificadas',
      };
    } else if (score >= 70) {
      return {
        label: 'Bueno',
        color: '#3B82F6', // blue
        emoji: '🔵',
        description: 'Buena cantidad de evidencia con confiabilidad media-alta',
      };
    } else if (score >= 50) {
      return {
        label: 'Regular',
        color: '#F59E0B', // yellow
        emoji: '🟡',
        description: 'Evidencia moderada que requiere más investigación',
      };
    } else if (score >= 30) {
      return {
        label: 'Bajo',
        color: '#EF4444', // red
        emoji: '🟠',
        description: 'Poca evidencia o baja confiabilidad',
      };
    } else {
      return {
        label: 'Muy Bajo',
        color: '#DC2626', // dark red
        emoji: '🔴',
        description: 'Insuficiente evidencia para conclusiones',
      };
    }
  }
}
