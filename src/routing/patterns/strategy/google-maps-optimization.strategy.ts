import { Injectable } from '@nestjs/common';
import { RouteOptimizationStrategy } from './route-optimization-strategy.interface';
import { RouteOptimizationOptions, RouteOptimizationResult, RouteDraft } from './route-optimization.types';

@Injectable()
export class GoogleMapsOptimizationStrategy implements RouteOptimizationStrategy {
  private readonly googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';

  async optimize(
    routes: RouteDraft[],
    options?: RouteOptimizationOptions,
  ): Promise<RouteOptimizationResult> {
    if (!this.googleMapsApiKey.trim()) {
      throw new Error('GOOGLE_MAPS_API_KEY no configurada');
    }

    const optimizedRoutes: RouteDraft[] = [];
    let success = 0;
    let failed = 0;

    for (const route of routes) {
      try {
        const optimized = await this.optimizeSingleRoute(route, options?.originLat, options?.originLng);
        optimizedRoutes.push(optimized);
        success += 1;
      } catch {
        failed += 1;
        optimizedRoutes.push(route);
      }
    }

    return {
      routes: optimizedRoutes,
      optimizedRoutes: success,
      failedRoutes: failed,
    };
  }

  private async optimizeSingleRoute(route: RouteDraft, originLat?: number, originLng?: number): Promise<RouteDraft> {
    if (route.stops.length <= 1) {
      return route;
    }

    const startLat = originLat ?? route.stops[0].lat;
    const startLng = originLng ?? route.stops[0].lng;

    const waypoints = route.stops.map((s) => `${s.lat},${s.lng}`).join('|');
    const directionsUrl =
      'https://maps.googleapis.com/maps/api/directions/json?' +
      `origin=${encodeURIComponent(`${startLat},${startLng}`)}` +
      `&destination=${encodeURIComponent(`${startLat},${startLng}`)}` +
      `&waypoints=${encodeURIComponent(`optimize:true|${waypoints}`)}` +
      '&mode=driving' +
      `&key=${encodeURIComponent(this.googleMapsApiKey)}`;

    const response = await fetch(directionsUrl);
    if (!response.ok) {
      throw new Error(`Google Directions HTTP ${response.status}`);
    }

    const data = (await response.json()) as {
      status?: string;
      routes?: Array<{
        waypoint_order?: number[];
        legs?: Array<{
          distance?: { value?: number };
          duration?: { value?: number };
        }>;
      }>;
    };

    if (data.status !== 'OK' || !data.routes?.length) {
      throw new Error(`Google Directions status=${data.status ?? 'unknown'}`);
    }

    const best = data.routes[0];
    const order = best.waypoint_order ?? route.stops.map((_, idx) => idx);
    const reorderedStops = order.map((idx, i) => ({
      ...route.stops[idx],
      sequence: i + 1,
    }));

    const legs = best.legs ?? [];
    let totalDistanceKm = 0;
    let totalDurationMin = 0;

    const stopsWithMetrics = reorderedStops.map((stop, index) => {
      const leg = legs[index];
      const distanceMeters = leg?.distance?.value ?? 0;
      const durationSeconds = leg?.duration?.value ?? 0;
      const distanceKm = distanceMeters / 1000;
      const durationMin = Math.max(0, Math.round(durationSeconds / 60));

      totalDistanceKm += distanceKm;
      totalDurationMin += durationMin;

      return {
        ...stop,
        distanceFromPreviousKm: Number(distanceKm.toFixed(3)),
        durationFromPreviousMin: durationMin,
      };
    });

    return {
      ...route,
      stops: stopsWithMetrics,
      totalDistanceKm: Number(totalDistanceKm.toFixed(3)),
      totalDurationMin,
    };
  }
}
