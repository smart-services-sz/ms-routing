import { HttpException, HttpStatus } from '@nestjs/common';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { PrismaService } from '../prisma/prisma.service';
import { of, throwError } from 'rxjs';
import { RoutingPlannerContext } from './patterns/strategy/routing-planner.context';
import { RouteLifecycleContext } from './patterns/state/route-lifecycle.context';
import { RouteStateFactory } from './patterns/state/route-state.factory';
import { RoutingService } from './routing.service';
import { RoutingController as RoutingRpcController } from './routing.controller';

const municipalityId = 'municipio_a';

type GenerationRequestModelMock = {
  findUnique: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
};

type RoutingPlanModelMock = {
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
};

type RoutingRouteModelMock = {
  updateMany: jest.Mock;
};

type RoutingStopModelMock = {
  findMany: jest.Mock;
};

type RoutingClaimAllocationModelMock = {
  findMany: jest.Mock;
  upsert: jest.Mock;
  updateMany: jest.Mock;
};

type RoutingActionHistoryModelMock = {
  create: jest.Mock;
  findMany: jest.Mock;
};

type RoutingTransactionMock = {
  routingPlan: RoutingPlanModelMock;
  routingRoute: RoutingRouteModelMock;
  routingStop: RoutingStopModelMock;
  routingClaimAllocation: RoutingClaimAllocationModelMock;
  routingActionHistory: RoutingActionHistoryModelMock;
};

type PrismaMock = {
  routingGenerationRequest: GenerationRequestModelMock;
  routingPlan: RoutingPlanModelMock;
  routingClaimAllocation: RoutingClaimAllocationModelMock;
  routingActionHistory: RoutingActionHistoryModelMock;
  $transaction: jest.Mock;
};

type NatsClientMock = {
  send: jest.Mock;
};

function createService(
  prisma: PrismaMock,
  natsClient: NatsClientMock = { send: jest.fn().mockReturnValue(of({ status: 'updated' })) },
): RoutingService {
  return new RoutingService(
    prisma as unknown as PrismaService,
    natsClient as unknown as ClientProxy,
    {} as RoutingPlannerContext,
    new RouteLifecycleContext(new RouteStateFactory()),
  );
}

function createTransactionMock(): RoutingTransactionMock {
  return {
    routingPlan: {
      findUnique: jest.fn(),
      create: jest.fn().mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    routingRoute: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    routingStop: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { reclamoId: '11111111-1111-4111-8111-111111111111' },
          { reclamoId: '22222222-2222-4222-8222-222222222222' },
        ]),
    },
    routingClaimAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    routingActionHistory: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function createPrismaMock(tx = createTransactionMock()): PrismaMock {
  return {
    routingGenerationRequest: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    routingPlan: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    routingClaimAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    routingActionHistory: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(
      (callback: (transaction: RoutingTransactionMock) => Promise<unknown>) =>
        callback(tx),
    ),
  };
}

describe('RoutingService', () => {
  describe('municipal ownership', () => {
    function scopedService() {
      const base = createPrismaMock();
      const date = new Date('2026-10-15T00:00:00Z');
      const plans = [
        { id: 'plan-a', municipalityId: 'municipio_a' },
        { id: 'plan-b', municipalityId: 'municipio_b' },
        { id: 'legacy', municipalityId: null },
      ].map((plan) => ({ ...plan, planningDate: date, createdAt: date, updatedAt: date,
        status: 'proposed', summary: {}, routes: [], unassigned: [], _count: { routes: 0, unassigned: 0 } }));
      const findMany = () => jest.fn(async ({ where }: { where: { municipalityId: string } }) =>
        plans.filter((plan) => plan.municipalityId === where.municipalityId));
      const findUnique = () => jest.fn(async ({ where }: { where: { id: string; municipalityId: string } }) =>
        plans.find((plan) => plan.id === where.id && plan.municipalityId === where.municipalityId) ?? null);
      const prisma = {
        ...base,
        routingPlan: { ...base.routingPlan, findMany: findMany(), findUnique: findUnique(), delete: jest.fn(), groupBy: jest.fn().mockResolvedValue([{ status: 'confirmed', _count: { _all: 2 } }]) },
        routingAreaPlan: { findMany: findMany(), findUnique: findUnique(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
        routingRoute: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), groupBy: jest.fn().mockResolvedValue([{ status: 'completed', _count: { _all: 1 }, _sum: { assignedClaims: 4, totalDistanceKm: 12, totalDurationMin: 45 } }]) },
        routingStop: { findUnique: jest.fn().mockResolvedValue(null), groupBy: jest.fn().mockResolvedValue([{ status: 'visitado', categoria: 'alumbrado', _count: { _all: 4 } }]) },
        routingIntervention: { findUnique: jest.fn().mockResolvedValue(null), groupBy: jest.fn().mockResolvedValue([{ result: 'resuelto', _count: { _all: 3 } }]) },
        routingInterventionEvidence: { count: jest.fn().mockResolvedValue(2) },
        routingUnassigned: { groupBy: jest.fn().mockResolvedValue([{ reason: 'no_eligible_crew', _count: { _all: 1 } }]) },
        $queryRaw: jest.fn().mockResolvedValue([{ period: new Date('2026-10-15T00:00:00Z'), plans: 2 }]),
      };
      return { service: createService(prisma), prisma };
    }

    it.each(['municipio_a', 'municipio_b'])('lists only plans belonging to %s, excluding unassigned legacy data', async (scope) => {
      const { service } = scopedService();
      const expectedId = scope === 'municipio_a' ? 'plan-a' : 'plan-b';
      expect((await service.listPlans(scope)).data.map((plan) => plan.id)).toEqual([expectedId]);
      expect((await service.listAreaPlans(scope)).data.map((plan) => plan.id)).toEqual([expectedId]);
    });

    it('aggregates plans, routes, stops, interventions and evidence only through the municipal plan', async () => {
      const { service, prisma } = scopedService();
      const result = await service.getMetrics({ municipalityId: 'municipio_a', from: '2026-10-01', to: '2026-10-16', bucketDays: 7 });
      expect(prisma.routingPlan.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { municipalityId: 'municipio_a', planningDate: { gte: expect.any(Date), lt: expect.any(Date) } } }));
      expect(prisma.routingRoute.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ plan: expect.objectContaining({ municipalityId: 'municipio_a' }) }) }));
      expect(prisma.routingStop.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { route: { plan: expect.objectContaining({ municipalityId: 'municipio_a' }) } } }));
      expect(prisma.routingIntervention.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { route: { plan: expect.objectContaining({ municipalityId: 'municipio_a' }) } } }));
      expect(prisma.routingUnassigned.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { plan: expect.objectContaining({ municipalityId: 'municipio_a' }) } }));
      expect(prisma.routingInterventionEvidence.count).toHaveBeenCalledWith({ where: { intervention: { route: { plan: expect.objectContaining({ municipalityId: 'municipio_a' }) } } } });
      expect(result.summary).toMatchObject({ totalPlans: 2, totalRoutes: 1, assignedClaims: 4, evidences: 2 });
      expect(JSON.stringify(result)).not.toContain('direccion');
    });

    it('denies foreign plan detail and history before reading the history', async () => {
      const { service, prisma } = scopedService();
      await expect(service.getPlan('plan-b', 'municipio_a')).rejects.toMatchObject({ status: 404 });
      expect(prisma.routingActionHistory.findMany).not.toHaveBeenCalled();
      await expect(service.getPlan('plan-a', 'municipio_a')).resolves.toMatchObject({ data: { id: 'plan-a' } });
    });

    it('rejects confirmation, deletion and area-plan overwrite across municipalities', async () => {
      const { service, prisma } = scopedService();
      await expect(service.confirmPlan('plan-b', 'municipio_a')).rejects.toMatchObject({ status: 404 });
      await expect(service.deletePlan('plan-b', 'municipio_a')).rejects.toMatchObject({ status: 404 });
      await expect(service.deleteAreaPlan('plan-b', 'municipio_a')).rejects.toMatchObject({ status: 404 });
      await expect(service.saveAreaPlan({ id: 'plan-b', municipalityId: 'municipio_a' } as never)).rejects.toMatchObject({ status: 404 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.routingAreaPlan.update).not.toHaveBeenCalled();
      expect(prisma.routingAreaPlan.create).not.toHaveBeenCalled();
      expect(prisma.routingAreaPlan.delete).not.toHaveBeenCalled();
    });

    it('filters direct route, stop and intervention lookups through the owning municipal plan even for admins', async () => {
      const { service, prisma } = scopedService();
      await expect(service.getAssignedRoute({ userId: 'agent-1', municipalityId })).rejects.toMatchObject({ status: 404 });
      await expect(service.updateRouteStatus({ routeId: 'foreign-route', status: 'in_progress', actorIsAdmin: true, municipalityId } as never)).rejects.toMatchObject({ status: 404 });
      await expect(service.registerIntervention({ routeId: 'foreign-route', stopId: 'foreign-stop', actorIsAdmin: true, municipalityId } as never)).rejects.toMatchObject({ status: 404 });
      await expect(service.attachInterventionEvidence({ interventionId: 'foreign-intervention', actorIsAdmin: true, municipalityId } as never)).rejects.toMatchObject({ status: 404 });
      expect(prisma.routingRoute.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign-route', plan: { municipalityId } } }));
      expect(prisma.routingStop.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign-stop', route: { plan: { municipalityId } } } }));
      expect(prisma.routingIntervention.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'foreign-intervention', route: { plan: { municipalityId } } } }));
      expect(prisma.routingRoute.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ crewId: 'agent-1', plan: { municipalityId, status: 'confirmed' } }) }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not fall back to global operations when a municipality is missing', async () => {
      const { service, prisma } = scopedService();
      for (const operation of [
        () => service.listPlans(), () => service.listAreaPlans(),
        () => service.getPlan('plan-a'), () => service.confirmPlan('plan-a'),
        () => service.deletePlan('plan-a'), () => service.getAreaPlan('plan-a'),
        () => service.deleteAreaPlan('plan-a'), () => service.simulate({}),
        () => service.generate({ idempotencyKey: 'shared-key' }),
        () => service.saveAreaPlan({} as never), () => service.getAssignedRoutes({}),
        () => service.getAssignedRoute({}), () => service.updateRouteStatus({} as never),
        () => service.registerIntervention({} as never), () => service.attachInterventionEvidence({} as never),
      ]) await expect(operation()).rejects.toMatchObject({ status: 403 });
      expect(prisma.routingGenerationRequest.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('keeps cached generation responses separate for the same key in different municipalities', async () => {
      const { service, prisma } = scopedService();
      prisma.routingGenerationRequest.findUnique.mockImplementation(async ({ where }: { where: { municipalityId_idempotencyKey: { municipalityId: string } } }) => ({
        status: 'completed', response: { savedPlanId: where.municipalityId_idempotencyKey.municipalityId },
      }));
      await expect(service.generate({ municipalityId: 'municipio_a', idempotencyKey: 'shared-key' })).resolves.toEqual({ savedPlanId: 'municipio_a' });
      await expect(service.generate({ municipalityId: 'municipio_b', idempotencyKey: 'shared-key' })).resolves.toEqual({ savedPlanId: 'municipio_b' });
      expect(prisma.routingGenerationRequest.findUnique).toHaveBeenNthCalledWith(2, {
        where: { municipalityId_idempotencyKey: { municipalityId: 'municipio_b', idempotencyKey: 'shared-key' } },
      });
    });

    it('preserves municipal scope at the NATS controller boundary', () => {
      const mocks = { getRules: jest.fn(), listPlans: jest.fn(), listAreaPlans: jest.fn(), getPlan: jest.fn(), getAreaPlan: jest.fn(), confirmPlan: jest.fn(), deletePlan: jest.fn(), deleteAreaPlan: jest.fn(), upsertRules: jest.fn() };
      const controller = new RoutingRpcController(mocks as unknown as RoutingService);
      const scope = { municipalityId };
      const payload = { id: 'plan-a', municipalityId };
      controller.getRules(scope); controller.listPlans(scope); controller.listAreaPlans(scope);
      controller.getPlan(payload); controller.getAreaPlan(payload); controller.confirmPlan(payload);
      controller.deletePlan(payload); controller.deleteAreaPlan(payload);
      controller.upsertRules({ categoryRules: [], crews: [], municipalityId });
      for (const method of [mocks.getRules, mocks.listPlans, mocks.listAreaPlans]) expect(method).toHaveBeenCalledWith(municipalityId);
      for (const method of [mocks.getPlan, mocks.getAreaPlan, mocks.confirmPlan, mocks.deletePlan, mocks.deleteAreaPlan]) expect(method).toHaveBeenCalledWith('plan-a', municipalityId);
      expect(mocks.upsertRules).toHaveBeenCalledWith(expect.objectContaining({ municipalityId }), municipalityId);
    });
  });

  describe('municipal rules', () => {
    function ruleService() {
      const models = {
        routingCategoryRule: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn() },
        routingCrewRule: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn() },
        routingZoneRule: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), createMany: jest.fn() },
      };
      const prisma = { ...createPrismaMock(), ...models,
        $transaction: jest.fn((callback: (tx: typeof models) => Promise<unknown>) => callback(models)),
      };
      return { service: createService(prisma), models };
    }

    it('replaces and reads rules only within the selected municipality', async () => {
      const { service, models } = ruleService();
      await service.upsertRules({
        categoryRules: [{ categoria: 'alumbrado', cupoDiario: 2 }],
        crews: [{ userId: 'agent-1', maxReclamosDiarios: 2, allowedCategorias: ['alumbrado'] }],
        zones: [{ id: 'centro', minLat: -33, maxLat: -32, minLng: -61, maxLng: -60 }],
      }, 'municipio_a');
      await service.getRules('municipio_a');
      for (const model of Object.values(models)) {
        expect(model.deleteMany).toHaveBeenCalledWith({ where: { municipalityId: 'municipio_a' } });
        expect(model.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ municipalityId: 'municipio_a' })] });
        expect(model.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { municipalityId: 'municipio_a' } }));
      }
    });

    it('rejects unscoped rule requests before touching the database', async () => {
      const { service, models } = ruleService();
      await expect(service.getRules()).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      await expect(service.upsertRules({ categoryRules: [], crews: [] })).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
      for (const model of Object.values(models)) expect(model.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('agent execution', () => {
    function executionService(
      routeStatus = 'in_progress',
      stopStatus = 'pendiente',
      natsClient: NatsClientMock = { send: jest.fn().mockReturnValue(of({ status: 'updated' })) },
    ) {
      const tx = {
        ...createTransactionMock(),
        routingStop: {
          count: jest.fn().mockResolvedValue(0),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        routingIntervention: { upsert: jest.fn().mockResolvedValue({ id: 'intervention-1' }) },
        routingRoute: { update: jest.fn().mockResolvedValue({}) },
      };
      const prisma = {
        ...createPrismaMock(),
        routingRoute: {
          findMany: jest.fn().mockResolvedValue([]),
          findUnique: jest.fn().mockResolvedValue({
            id: 'route-1', crewId: 'agent-1', status: routeStatus,
            startedAt: null, plan: { status: 'confirmed' },
          }),
        },
        routingStop: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'stop-2', routeId: 'route-1', sequence: 2, status: stopStatus, reclamoId: 'claim-2',
            route: { crewId: 'agent-1', status: routeStatus, startedAt: new Date('2026-10-13T08:00:00Z'), plan: { status: 'confirmed' } },
          }),
        },
        $transaction: jest.fn((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
      };
      return { service: createService(prisma, natsClient), prisma, tx };
    }

    const intervention = {
      municipalityId,
      routeId: 'route-1', stopId: 'stop-2', result: 'resuelto' as const,
      actorId: 'agent-1', actorIsAdmin: false,
    };

    it('lists only the operator routes from confirmed plans', async () => {
      const { service, prisma } = executionService();
      expect(await service.getAssignedRoutes({ userId: 'agent-1', municipalityId })).toEqual({ status: 'ok', data: [] });
      expect(prisma.routingRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { crewId: 'agent-1', status: { in: ['assigned', 'in_progress', 'completed'] }, plan: { municipalityId, status: 'confirmed' } },
      }));
    });

    it('rejects work before the route starts', async () => {
      const { service, prisma } = executionService('assigned');
      await expect(service.registerIntervention(intervention)).rejects.toThrow('Debe comenzar la ruta');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a stop when an earlier stop is still pending', async () => {
      const { service, tx } = executionService();
      tx.routingStop.count.mockResolvedValue(1);
      await expect(service.registerIntervention(intervention)).rejects.toThrow('trabajos anteriores en orden');
      expect(tx.routingIntervention.upsert).not.toHaveBeenCalled();
      expect(tx.routingStop.count).toHaveBeenCalledWith({ where: { routeId: 'route-1', status: 'pendiente', sequence: { lt: 2 } } });
    });

    it('rejects already registered work', async () => {
      const { service } = executionService('in_progress', 'resuelto');
      await expect(service.registerIntervention(intervention)).rejects.toThrow('trabajo pendiente');
    });

    it('rejects concurrent duplicate registration', async () => {
      const { service, tx } = executionService();
      tx.routingStop.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.registerIntervention(intervention)).rejects.toThrow('ya fue registrado');
      expect(tx.routingIntervention.upsert).not.toHaveBeenCalled();
    });

    it('does not let an agent manually complete an unfinished route', async () => {
      const { service } = executionService();
      await expect(service.updateRouteStatus({ routeId: 'route-1', status: 'completed', actorId: 'agent-1', municipalityId })).rejects.toThrow('Solo puede comenzar');
    });

    it('does not let another agent execute the route', async () => {
      const { service } = executionService();
      await expect(service.registerIntervention({ ...intervention, actorId: 'agent-2' })).rejects.toThrow('no pertenece a la ruta');
    });

    it.each(['resuelto', 'no_resuelto', 'requiere_nueva_visita', 'no_corresponde'] as const)(
      'closes the second and last stop with result %s using the real lifecycle',
      async (result) => {
        const natsClient = { send: jest.fn().mockReturnValue(of({ status: 'updated' })) };
        const { service, tx } = executionService('in_progress', 'pendiente', natsClient);
        tx.routingStop.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
        await expect(service.registerIntervention({ ...intervention, result })).resolves.toMatchObject({ status: 'ok' });
        expect(tx.routingRoute.update).toHaveBeenCalledWith({
          where: { id: 'route-1' },
          data: expect.objectContaining({ status: 'completed', startedAt: new Date('2026-10-13T08:00:00Z'), completedAt: expect.any(Date) }),
        });
        expect(natsClient.send).toHaveBeenCalledWith('reclamos.update', expect.objectContaining({ id: 'claim-2' }));
      },
    );

    it('keeps the route in progress when stops remain after the second job', async () => {
      const { service, tx } = executionService();
      tx.routingStop.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await expect(service.registerIntervention(intervention)).resolves.toMatchObject({ status: 'ok' });
      expect(tx.routingRoute.update).not.toHaveBeenCalled();
    });

    it('reports saved work explicitly when claim synchronization fails', async () => {
      const failure = new Error('reclamos.update failed');
      const natsClient = { send: jest.fn().mockReturnValue(throwError(() => failure)) };
      const { service, tx } = executionService('in_progress', 'pendiente', natsClient);
      const response = service.registerIntervention(intervention).catch((error: unknown) => {
        expect(error).toBeInstanceOf(RpcException);
        return (error as RpcException).getError();
      });
      await expect(response).resolves.toEqual({
        statusCode: HttpStatus.BAD_GATEWAY,
        message: 'El trabajo fue registrado, pero fallo la sincronizacion del reclamo.',
        interventionSaved: true,
        interventionId: 'intervention-1',
        routeId: 'route-1',
        stopId: 'stop-2',
      });
      expect(tx.routingIntervention.upsert).toHaveBeenCalled();
      expect(tx.routingRoute.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }));
    });
  });

  describe('simulate claim filters', () => {
    it('sends supported filters to reclamos and applies local filtering as a guard', async () => {
      const prisma = createPrismaMock();
      const natsClient: NatsClientMock = {
        send: jest.fn().mockReturnValue(
          of({
            items: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                categoria: 'alumbrado',
                prioridad: 'alta',
                estado: 'pendiente',
                municipalityId: 'ciudad_prueba',
                areaId: 'area-centro',
                lat: -34.55,
                lng: -58.45,
                direccion: 'Calle 1',
              },
              {
                id: 'foreign-claim', categoria: 'alumbrado', prioridad: 'alta',
                estado: 'pendiente', municipalityId: 'otra_ciudad', areaId: 'area-centro',
                lat: -34.55, lng: -58.45, direccion: 'Calle 3',
              },
              {
                id: 'legacy-claim', categoria: 'alumbrado', prioridad: 'alta',
                estado: 'pendiente', municipalityId: null, areaId: 'area-centro',
                lat: -34.55, lng: -58.45, direccion: 'Calle 4',
              },
              {
                id: '22222222-2222-4222-8222-222222222222',
                categoria: 'residuos',
                prioridad: 'baja',
                estado: 'cerrado',
                lat: -34.56,
                lng: -58.46,
                direccion: 'Calle 2',
              },
            ],
            pagination: { hasNextPage: false },
          }),
        ),
      };
      const service = createService(prisma, natsClient);

      const result = await service.simulate({
        maxFetch: 50,
        useGoogleOptimization: false,
        claimStatuses: ['pendiente'],
        priorities: ['alta'],
        categories: ['alumbrado'],
        municipalityId: 'ciudad_prueba',
        areaId: 'area-centro',
        overrideRules: {
          categoryRules: [
            { categoria: 'alumbrado', cupoDiario: 10, pesoPrioridad: 1 },
          ],
          crews: [
            {
              crewId: 'agent-1',
              maxReclamosDiarios: 10,
              allowedCategorias: ['alumbrado'],
            },
          ],
          zones: [],
        },
      });

      expect(natsClient.send).toHaveBeenCalledWith('reclamos.find-all', {
        page: 1,
        limit: 50,
        sortDirection: -1,
        estado: 'pendiente',
        categoria: 'alumbrado',
        prioridad: 'alta',
        municipalityId: 'ciudad_prueba',
        areaId: 'area-centro',
      });
      expect(result.summary.totalFetched).toBe(1);
      expect(result.summary.totalAssigned).toBe(1);
      expect(result.routes[0].stops).toHaveLength(1);
      expect(result.routes[0].stops[0].reclamoId).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
    });

    it('uses category priority weight when assigning limited route capacity', async () => {
      const prisma = createPrismaMock();
      const natsClient: NatsClientMock = {
        send: jest.fn().mockReturnValue(
          of({
            items: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                categoria: 'alumbrado',
                prioridad: 'media',
                estado: 'pendiente',
                municipalityId,
                lat: -34.55,
                lng: -58.45,
                direccion: 'Calle 1',
              },
              {
                id: '22222222-2222-4222-8222-222222222222',
                categoria: 'baches_y_pavimento',
                prioridad: 'media',
                estado: 'pendiente',
                municipalityId,
                lat: -34.56,
                lng: -58.46,
                direccion: 'Calle 2',
              },
            ],
            pagination: { hasNextPage: false },
          }),
        ),
      };
      const service = createService(prisma, natsClient);

      const result = await service.simulate({
        municipalityId,
        maxFetch: 50,
        useGoogleOptimization: false,
        claimStatuses: ['pendiente'],
        categories: ['alumbrado', 'baches_y_pavimento'],
        overrideRules: {
          categoryRules: [
            { categoria: 'alumbrado', cupoDiario: 10, pesoPrioridad: 1 },
            {
              categoria: 'baches_y_pavimento',
              cupoDiario: 10,
              pesoPrioridad: 5,
            },
          ],
          crews: [
            {
              crewId: 'agent-1',
              maxReclamosDiarios: 1,
              allowedCategorias: ['alumbrado', 'baches_y_pavimento'],
            },
          ],
          zones: [],
        },
      });

      expect(result.summary.totalFetched).toBe(2);
      expect(result.summary.totalAssigned).toBe(1);
      expect(result.routes[0].stops[0].reclamoId).toBe(
        '22222222-2222-4222-8222-222222222222',
      );
      expect(result.unassigned).toEqual([
        {
          reclamoId: '11111111-1111-4111-8111-111111111111',
          reason: 'no_eligible_crew',
        },
      ]);
    });
  });

  describe('getPlan history', () => {
    it('returns action history ordered with the plan detail', async () => {
      const prisma = createPrismaMock();
      prisma.routingPlan.findUnique.mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        planningDate: new Date('2026-09-03T00:00:00.000Z'),
        status: 'proposed',
        summary: {},
        routes: [],
        unassigned: [],
      });
      prisma.routingActionHistory.findMany.mockResolvedValue([
        {
          id: '44444444-4444-4444-8444-444444444444',
          action: 'plan.generated',
          planId: '33333333-3333-4333-8333-333333333333',
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
        },
      ]);
      const service = createService(prisma);

      await expect(
        service.getPlan('33333333-3333-4333-8333-333333333333', municipalityId),
      ).resolves.toMatchObject({
        status: 'ok',
        data: {
          id: '33333333-3333-4333-8333-333333333333',
          actionHistory: [
            {
              action: 'plan.generated',
              planId: '33333333-3333-4333-8333-333333333333',
            },
          ],
        },
      });
      expect(prisma.routingActionHistory.findMany).toHaveBeenCalledWith({
        where: { planId: '33333333-3333-4333-8333-333333333333' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('generate idempotency', () => {
    it('returns the cached response when the idempotency key is completed', async () => {
      const cachedResponse = {
        status: 'ok',
        savedPlanId: '33333333-3333-4333-8333-333333333333',
      };
      const prisma = createPrismaMock();
      prisma.routingGenerationRequest.findUnique.mockResolvedValue({
        idempotencyKey: 'routing-key-1',
        status: 'completed',
        response: cachedResponse,
      });
      const service = createService(prisma);

      await expect(
        service.generate({ idempotencyKey: 'routing-key-1', municipalityId }),
      ).resolves.toEqual(cachedResponse);
      expect(prisma.routingGenerationRequest.upsert).not.toHaveBeenCalled();
    });

    it('records plan generation history when a new plan is persisted', async () => {
      const tx = createTransactionMock();
      const prisma = createPrismaMock(tx);
      const natsClient: NatsClientMock = {
        send: jest.fn().mockReturnValue(
          of({
            items: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                categoria: 'alumbrado',
                prioridad: 'alta',
                estado: 'pendiente',
                municipalityId,
                lat: -34.55,
                lng: -58.45,
                direccion: 'Calle 1',
              },
            ],
            pagination: { hasNextPage: false },
          }),
        ),
      };
      const service = createService(prisma, natsClient);

      await expect(
        service.generate({
          municipalityId,
          maxFetch: 50,
          useGoogleOptimization: false,
          claimStatuses: ['pendiente'],
          categories: ['alumbrado'],
          overrideRules: {
            categoryRules: [
              { categoria: 'alumbrado', cupoDiario: 10, pesoPrioridad: 1 },
            ],
            crews: [
              {
                crewId: 'agent-1',
                maxReclamosDiarios: 10,
                allowedCategorias: ['alumbrado'],
              },
            ],
            zones: [],
          },
        }),
      ).resolves.toMatchObject({
        status: 'ok',
        savedPlanId: '33333333-3333-4333-8333-333333333333',
      });
      expect(tx.routingActionHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'plan.generated',
          planId: '33333333-3333-4333-8333-333333333333',
          newStatus: 'proposed',
          metadata: {
            planningDate: expect.any(String) as string,
            routeCount: 1,
            assignedClaimCount: 1,
            unassignedCount: 0,
          },
        }) as object,
      });
      expect(tx.routingPlan.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ municipalityId }) }));
    });

    it('rejects a repeated request while the same idempotency key is processing', async () => {
      const prisma = createPrismaMock();
      prisma.routingGenerationRequest.findUnique.mockResolvedValue({
        idempotencyKey: 'routing-key-2',
        status: 'processing',
      });
      const service = createService(prisma);

      await expect(
        service.generate({ idempotencyKey: 'routing-key-2', municipalityId }),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
      expect(prisma.routingGenerationRequest.upsert).not.toHaveBeenCalled();
    });

    it('rejects generation when a selected claim becomes reserved before persistence', async () => {
      const tx = createTransactionMock();
      tx.routingClaimAllocation.findMany.mockResolvedValue([
        { claimId: '11111111-1111-4111-8111-111111111111' },
      ]);
      const prisma = createPrismaMock(tx);
      const natsClient: NatsClientMock = {
        send: jest.fn().mockReturnValue(
          of({
            items: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                categoria: 'alumbrado',
                prioridad: 'alta',
                estado: 'pendiente',
                municipalityId,
                lat: -34.55,
                lng: -58.45,
                direccion: 'Calle 1',
              },
            ],
            pagination: { hasNextPage: false },
          }),
        ),
      };
      const service = createService(prisma, natsClient);

      await expect(
        service.generate({
          municipalityId,
          maxFetch: 50,
          useGoogleOptimization: false,
          claimStatuses: ['pendiente'],
          categories: ['alumbrado'],
          overrideRules: {
            categoryRules: [
              { categoria: 'alumbrado', cupoDiario: 10, pesoPrioridad: 1 },
            ],
            crews: [
              {
                crewId: 'agent-1',
                maxReclamosDiarios: 10,
                allowedCategorias: ['alumbrado'],
              },
            ],
            zones: [],
          },
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
      expect(tx.routingClaimAllocation.upsert).not.toHaveBeenCalled();
    });
  });

  describe('confirmPlan', () => {
    it('is idempotent when the plan is already confirmed', async () => {
      const prisma = createPrismaMock();
      prisma.routingPlan.findUnique.mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        status: 'confirmed',
      });
      const service = createService(prisma);

      await expect(
        service.confirmPlan('33333333-3333-4333-8333-333333333333', municipalityId),
      ).resolves.toEqual({
        status: 'ok',
        message: 'Plan ya estaba confirmado',
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws not found when the plan does not exist', async () => {
      const prisma = createPrismaMock();
      prisma.routingPlan.findUnique.mockResolvedValue(null);
      const service = createService(prisma);

      await expect(
        service.confirmPlan('33333333-3333-4333-8333-333333333333', municipalityId),
      ).rejects.toBeInstanceOf(HttpException);
      await expect(
        service.confirmPlan('33333333-3333-4333-8333-333333333333', municipalityId),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('confirms the plan, routes and claim allocations in one transaction', async () => {
      const tx = createTransactionMock();
      const prisma = createPrismaMock(tx);
      prisma.routingPlan.findUnique.mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333',
        status: 'proposed',
      });
      const service = createService(prisma);

      await expect(
        service.confirmPlan('33333333-3333-4333-8333-333333333333', municipalityId),
      ).resolves.toEqual({
        status: 'ok',
        message: 'Plan confirmado correctamente',
      });

      expect(tx.routingPlan.update).toHaveBeenCalledWith({
        where: { id: '33333333-3333-4333-8333-333333333333', municipalityId },
        data: { status: 'confirmed' },
      });
      expect(tx.routingRoute.updateMany).toHaveBeenCalledWith({
        where: { planId: '33333333-3333-4333-8333-333333333333' },
        data: {
          status: 'assigned',
          assignedAt: expect.any(Date) as Date,
        },
      });
      expect(tx.routingClaimAllocation.upsert).toHaveBeenCalledTimes(2);
      expect(tx.routingClaimAllocation.updateMany).toHaveBeenCalledWith({
        where: {
          claimId: {
            in: [
              '11111111-1111-4111-8111-111111111111',
              '22222222-2222-4222-8222-222222222222',
            ],
          },
          state: 'reserved',
          reservedByPlanId: { not: '33333333-3333-4333-8333-333333333333' },
        },
        data: {
          state: 'available',
          reservationToken: null,
          reservedByPlanId: null,
          reservedAt: null,
          expiresAt: null,
        },
      });
      expect(tx.routingActionHistory.create).toHaveBeenCalledWith({
        data: {
          action: 'plan.confirmed',
          planId: '33333333-3333-4333-8333-333333333333',
          routeId: undefined,
          stopId: undefined,
          interventionId: undefined,
          evidenceId: undefined,
          reclamoId: undefined,
          actorId: undefined,
          previousStatus: 'proposed',
          newStatus: 'confirmed',
          reason: undefined,
          metadata: { claimCount: 2 },
        },
      });
    });
  });
});
