export type ClaimCategoria =
  | 'agua_y_cloacas'
  | 'alumbrado'
  | 'baches_y_pavimento'
  | 'arbolado'
  | 'residuos'
  | 'electricidad'
  | 'gas'
  | 'transporte'
  | 'infraestructura'
  | 'otros';

export type ClaimPrioridad = 'alta' | 'media' | 'baja';

export type RoutingPlanStatus = 'proposed' | 'confirmed' | 'cancelled';
export type RoutingRouteStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled';
export type RoutingStopStatus = 'pendiente' | 'visitado' | 'omitido' | 'reprogramado';
export type InterventionResult =
  | 'resuelto'
  | 'no_resuelto'
  | 'requiere_nueva_visita'
  | 'no_corresponde';
export type EvidenceType = 'imagen' | 'video' | 'documento';

export interface ReclamoItem {
  id: string;
  categoria: ClaimCategoria;
  prioridad: ClaimPrioridad;
  lat: number;
  lng: number;
  direccion: string;
}

export interface SimulationSummary {
  totalFetched: number;
  totalCandidateAfterRules: number;
  totalAssigned: number;
  totalUnassigned: number;
  unassignedByReason: Record<string, number>;
  categoryQuotaConsumption: Record<string, number>;
  googleOptimization: {
    enabled: boolean;
    optimizedRoutes: number;
    failedRoutes: number;
  };
}
