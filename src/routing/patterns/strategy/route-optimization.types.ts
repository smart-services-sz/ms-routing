import { ClaimCategoria, ClaimPrioridad } from '../../routing.types';

export interface RouteStopDraft {
  sequence: number;
  reclamoId: string;
  categoria: ClaimCategoria;
  prioridad: ClaimPrioridad;
  zoneId: string | null;
  lat: number;
  lng: number;
  direccion: string;
  distanceFromPreviousKm: number;
  durationFromPreviousMin: number;
  createdAt: string;
}

export interface RouteDraft {
  crewId: string;
  nombre: string;
  assignedClaims: number;
  maxReclamosDiarios: number;
  totalDistanceKm: number;
  totalDurationMin: number;
  stops: RouteStopDraft[];
}

export interface RouteOptimizationResult {
  routes: RouteDraft[];
  optimizedRoutes: number;
  failedRoutes: number;
}

export interface RouteOptimizationOptions {
  originLat?: number;
  originLng?: number;
}
