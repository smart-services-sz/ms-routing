import { HttpException, HttpStatus } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../prisma/prisma.service';
import { of } from 'rxjs';
import { RoutingPlannerContext } from './patterns/strategy/routing-planner.context';
import { RouteLifecycleContext } from './patterns/state/route-lifecycle.context';
import { RoutingService } from './routing.service';

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
  natsClient: NatsClientMock = { send: jest.fn() },
): RoutingService {
  return new RoutingService(
    prisma as unknown as PrismaService,
    natsClient as unknown as ClientProxy,
    {} as RoutingPlannerContext,
    {} as RouteLifecycleContext,
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
                municipalityId: 'ciudad-prueba',
                areaId: 'area-centro',
                lat: -34.55,
                lng: -58.45,
                direccion: 'Calle 1',
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
        municipalityId: 'ciudad-prueba',
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
        municipalityId: 'ciudad-prueba',
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
                lat: -34.55,
                lng: -58.45,
                direccion: 'Calle 1',
              },
              {
                id: '22222222-2222-4222-8222-222222222222',
                categoria: 'baches_y_pavimento',
                prioridad: 'media',
                estado: 'pendiente',
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
        service.getPlan('33333333-3333-4333-8333-333333333333'),
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
        service.generate({ idempotencyKey: 'routing-key-1' }),
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
    });

    it('rejects a repeated request while the same idempotency key is processing', async () => {
      const prisma = createPrismaMock();
      prisma.routingGenerationRequest.findUnique.mockResolvedValue({
        idempotencyKey: 'routing-key-2',
        status: 'processing',
      });
      const service = createService(prisma);

      await expect(
        service.generate({ idempotencyKey: 'routing-key-2' }),
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
        service.confirmPlan('33333333-3333-4333-8333-333333333333'),
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
        service.confirmPlan('33333333-3333-4333-8333-333333333333'),
      ).rejects.toBeInstanceOf(HttpException);
      await expect(
        service.confirmPlan('33333333-3333-4333-8333-333333333333'),
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
        service.confirmPlan('33333333-3333-4333-8333-333333333333'),
      ).resolves.toEqual({
        status: 'ok',
        message: 'Plan confirmado correctamente',
      });

      expect(tx.routingPlan.update).toHaveBeenCalledWith({
        where: { id: '33333333-3333-4333-8333-333333333333' },
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
