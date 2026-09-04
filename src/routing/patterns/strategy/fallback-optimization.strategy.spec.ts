import { FallbackOptimizationStrategy } from './fallback-optimization.strategy';
import { RouteOptimizationStrategy } from './route-optimization-strategy.interface';
import { RouteDraft } from './route-optimization.types';

const routes: RouteDraft[] = [
  {
    crewId: 'agent-1',
    nombre: 'Agente 1',
    assignedClaims: 1,
    maxReclamosDiarios: 10,
    totalDistanceKm: 0,
    totalDurationMin: 0,
    stops: [
      {
        sequence: 1,
        reclamoId: '11111111-1111-4111-8111-111111111111',
        categoria: 'alumbrado',
        prioridad: 'alta',
        zoneId: 'zona-norte',
        lat: -34.55,
        lng: -58.45,
        direccion: 'Calle 1',
        distanceFromPreviousKm: 0,
        durationFromPreviousMin: 0,
        createdAt: '2026-09-03T00:00:00.000Z',
      },
    ],
  },
];

describe('FallbackOptimizationStrategy', () => {
  it('uses primary strategy when it succeeds', async () => {
    const primaryResult = {
      routes,
      optimizedRoutes: 1,
      failedRoutes: 0,
    };
    const fallbackOptimize = jest.fn().mockResolvedValue({
      routes,
      optimizedRoutes: 0,
      failedRoutes: 0,
    });
    const primary: RouteOptimizationStrategy = {
      optimize: jest.fn().mockResolvedValue(primaryResult),
    };
    const fallback: RouteOptimizationStrategy = {
      optimize: fallbackOptimize,
    };

    const strategy = new FallbackOptimizationStrategy(primary, fallback);

    await expect(strategy.optimize(routes)).resolves.toEqual(primaryResult);
    expect(fallbackOptimize).not.toHaveBeenCalled();
  });

  it('uses fallback strategy and marks every route as failed when primary fails', async () => {
    const fallbackOptimize = jest.fn().mockResolvedValue({
      routes,
      optimizedRoutes: 0,
      failedRoutes: 0,
    });
    const primary: RouteOptimizationStrategy = {
      optimize: jest.fn().mockRejectedValue(new Error('provider unavailable')),
    };
    const fallback: RouteOptimizationStrategy = {
      optimize: fallbackOptimize,
    };

    const strategy = new FallbackOptimizationStrategy(primary, fallback);

    await expect(strategy.optimize(routes)).resolves.toEqual({
      routes,
      optimizedRoutes: 0,
      failedRoutes: 1,
    });
    expect(fallbackOptimize).toHaveBeenCalledWith(routes, undefined);
  });
});
