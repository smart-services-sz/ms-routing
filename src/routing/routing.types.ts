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
