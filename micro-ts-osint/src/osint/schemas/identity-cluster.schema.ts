import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IdentityClusterDocument = IdentityCluster & Document;

/**
 * Identity Cluster Schema
 *
 * Vincula TODAS las identidades de una misma persona:
 * - Nombre real: "Usuario Demo"
 * - Aliases/usernames: ["operador-demo", "@operador-demo"]
 * - Emails: ["operador-demo@gmail.com"]
 * - Teléfonos: ["+52 555 123 4567"]
 *
 * Hay miles de "Usuario Demo" pero solo UNO con alias "operador-demo".
 * El cluster resuelve esa ambigüedad.
 *
 * Cada búsqueda nueva se vincula a un cluster existente (si coincide)
 * o crea uno nuevo.
 */
@Schema({ timestamps: true })
export class IdentityCluster {
  /**
   * Cluster slug único: usuario-demo-operador-demo
   * Se genera a partir de nombre + username principal
   */
  @Prop({ required: true, unique: true, index: true })
  slug: string;

  /**
   * Nombre de display: "Usuario Demo (operador-demo)"
   */
  @Prop({ required: true })
  displayName: string;

  /**
   * Nombre completo (si se conoce)
   */
  @Prop()
  fullName?: string;

  /**
   * Todos los aliases/usernames asociados
   */
  @Prop({ type: [String], default: [] })
  aliases: string[];

  /**
   * Todos los emails asociados
   */
  @Prop({ type: [String], default: [] })
  emails: string[];

  /**
   * Todos los teléfonos asociados
   */
  @Prop({ type: [String], default: [] })
  phones: string[];

  /**
   * IDs de búsquedas vinculadas a este cluster
   */
  @Prop({ type: [String], default: [] })
  searchIds: string[];

  /**
   * Total de evidencias acumuladas en TODAS las búsquedas
   */
  @Prop({ default: 0 })
  totalEvidence: number;

  /**
   * Scores acumulados (se recalculan con cada búsqueda)
   */
  @Prop({ type: Object })
  scores?: {
    identity: number;
    legal: number;
    financial: number;
    overall: number;
  };

  /**
   * Plataformas donde se encontró presencia
   */
  @Prop({ type: [String], default: [] })
  platforms: string[];

  /**
   * URLs de perfil confirmadas
   */
  @Prop({ type: [Object], default: [] })
  confirmedProfiles: Array<{
    platform: string;
    url: string;
    username?: string;
    confirmed: boolean;
  }>;

  /**
   * Imagen principal del cluster (si se tiene)
   */
  @Prop()
  primaryImageUrl?: string;

  /**
   * Screening de sanciones internacionales
   */
  @Prop({ type: Object })
  sanctionsScreening?: {
    riskLevel: string;     // LOW | MEDIUM | HIGH | CRITICAL
    riskScore: number;     // 0-100
    totalHits: number;
    lastScreened: Date;
    sourcesChecked: string[];
    summary: string;
  };

  /**
   * Notas adicionales
   */
  @Prop()
  notes?: string;

  /**
   * Activo
   */
  @Prop({ default: true })
  isActive: boolean;

  /**
   * Última vez que se ejecutó una búsqueda para este cluster
   */
  @Prop({ type: Date })
  lastSearched?: Date;

  // timestamps: true adds createdAt and updatedAt
  createdAt?: Date;
  updatedAt?: Date;
}

export const IdentityClusterSchema =
  SchemaFactory.createForClass(IdentityCluster);

// Indexes
IdentityClusterSchema.index({ aliases: 1 });
IdentityClusterSchema.index({ emails: 1 });
IdentityClusterSchema.index({ fullName: 'text', aliases: 'text', displayName: 'text' });
