import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SanctionsScreeningDocument = SanctionsScreening & Document;

/**
 * Sanctions Screening Schema
 *
 * Almacena el resultado de un screening contra listas de sanciones internacionales.
 * Se vincula a un searchId y opcionalmente a un clusterId.
 *
 * Fuentes:
 * - Interpol Red/Yellow Notices
 * - OpenSanctions (OFAC, ONU, Europol, FBI, UK HMT, PEPs)
 */
@Schema({ timestamps: true })
export class SanctionsScreening {
  /**
   * ID de la búsqueda OSINT asociada
   */
  @Prop({ required: true, index: true })
  searchId: string;

  /**
   * ID del identity cluster asociado
   */
  @Prop({ index: true })
  clusterId?: string;

  /**
   * Nombre buscado
   */
  @Prop({ required: true })
  searchedName: string;

  /**
   * Nivel de riesgo calculado
   */
  @Prop({
    required: true,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'LOW',
  })
  riskLevel: string;

  /**
   * Score numérico de riesgo (0-100)
   */
  @Prop({ required: true, default: 0 })
  riskScore: number;

  /**
   * Total de coincidencias encontradas
   */
  @Prop({ default: 0 })
  totalHits: number;

  /**
   * Hits detallados
   */
  @Prop({ type: [Object], default: [] })
  hits: Array<{
    source: string;
    listName: string;
    entityName: string;
    matchScore: number;
    details: string;
    url?: string;
    nationality?: string;
    dateOfBirth?: string;
    charges?: string;
  }>;

  /**
   * Fuentes consultadas
   */
  @Prop({ type: [String], default: [] })
  sourcesChecked: string[];

  /**
   * Duración del screening en ms
   */
  @Prop({ default: 0 })
  screeningDuration: number;

  /**
   * Resumen legible del resultado
   */
  @Prop()
  summary?: string;

  // timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export const SanctionsScreeningSchema =
  SchemaFactory.createForClass(SanctionsScreening);

// Indexes
SanctionsScreeningSchema.index({ searchId: 1, createdAt: -1 });
SanctionsScreeningSchema.index({ clusterId: 1, riskLevel: 1 });
