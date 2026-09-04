import { LocalOptimizationStrategy } from './local-optimization.strategy';
import { RouteDraft } from './route-optimization.types';

const route: RouteDraft = {
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
};

describe('LocalOptimizationStrategy', () => {
  it('returns the original route draft without reporting external optimization', async () => {
    const strategy = new LocalOptimizationStrategy();

    await expect(strategy.optimize([route])).resolves.toEqual({
      routes: [route],
      optimizedRoutes: 0,
      failedRoutes: 0,
    });
  });
});
