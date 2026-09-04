import { RouteLifecycleContext } from './route-lifecycle.context';
import { RouteStateFactory } from './route-state.factory';

describe('RouteLifecycleContext', () => {
  const now = new Date('2026-09-03T12:00:00.000Z');
  const context = new RouteLifecycleContext(new RouteStateFactory());

  it('starts an assigned route and clears previous completion date', () => {
    expect(
      context.transition({
        currentStatus: 'assigned',
        targetStatus: 'in_progress',
        startedAt: null,
        now,
      }),
    ).toEqual({
      status: 'in_progress',
      startedAt: now,
      completedAt: null,
    });
  });

  it('completes an assigned route using now as start date when needed', () => {
    expect(
      context.transition({
        currentStatus: 'assigned',
        targetStatus: 'completed',
        startedAt: null,
        now,
      }),
    ).toEqual({
      status: 'completed',
      startedAt: now,
      completedAt: now,
    });
  });

  it('keeps the original start date when completing an in-progress route', () => {
    const startedAt = new Date('2026-09-03T08:00:00.000Z');

    expect(
      context.transition({
        currentStatus: 'in_progress',
        targetStatus: 'completed',
        startedAt,
        now,
      }),
    ).toEqual({
      status: 'completed',
      startedAt,
      completedAt: now,
    });
  });

  it('returns a route to assigned clearing operational dates', () => {
    expect(
      context.transition({
        currentStatus: 'completed',
        targetStatus: 'assigned',
        startedAt: new Date('2026-09-03T08:00:00.000Z'),
        now,
      }),
    ).toEqual({
      status: 'assigned',
      startedAt: null,
      completedAt: null,
    });
  });
});
