import {
  HttpException,
  ForbiddenException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SimulateRoutingDto } from './dto/simulate-routing.dto';
import { UpsertRoutingRulesDto } from './dto/upsert-routing-rules.dto';
import { GetAssignedRouteDto } from './dto/get-assigned-route.dto';
import { UpdateRouteStatusDto } from './dto/update-route-status.dto';
import { RegisterInterventionDto } from './dto/register-intervention.dto';
import { AttachInterventionEvidenceDto } from './dto/attach-intervention-evidence.dto';
import { SaveRoutingAreaPlanDto } from './dto/save-routing-area-plan.dto';
import {
  ClaimPrioridad,
  InterventionResult,
  ReclamoItem,
  RoutingRouteStatus,
  RoutingStopStatus,
  SimulationSummary,
} from './routing.types';
import { firstValueFrom, timeout } from 'rxjs';
import { RoutingPlannerContext } from './patterns/strategy/routing-planner.context';
import { RouteDraft } from './patterns/strategy/route-optimization.types';
import { RouteLifecycleContext } from './patterns/state/route-lifecycle.context';

type RoutingRulesSnapshot = {
  categoryRules: Array<{
    categoria: string;
    cupoDiario: number;
    pesoPrioridad?: number | null;
  }>;
  crews: Array<{
    crewId: string;
    userId?: string;
    nombre?: string | null;
    userName?: string | null;
    maxReclamosDiarios: number;
    allowedCategorias: string[];
    allowedZoneIds: string[];
    startLat?: number | null;
    startLng?: number | null;
  }>;
  zones: Array<{
    id: string;
    nombre?: string | null;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  }>;
};

type ReclamoRoutingResponse = {
  id: string;
  categoria: ReclamoItem['categoria'];
  prioridad: ReclamoItem['prioridad'];
  estado?: 'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado' | 'cerrado';
  municipalityId?: string | null;
  areaId?: string | null;
  lat: number | string;
  lng: number | string;
  direccion?: string | null;
};

type ReclamosFindAllResponse = {
  items: ReclamoRoutingResponse[];
  pagination?: { hasNextPage?: boolean };
};

type ClaimSelectionFilters = {
  statuses: Array<
    'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado' | 'cerrado'
  >;
  priorities: ReclamoItem['prioridad'][];
  categories: ReclamoItem['categoria'][];
  municipalityId?: string;
  areaId?: string;
};

type RoutingActionName =
  | 'plan.generated'
  | 'plan.confirmed'
  | 'route.status_changed'
  | 'intervention.registered'
  | 'evidence.attached';

type RoutingHistoryWriter = {
  routingActionHistory: {
    create: (args: {
      data: {
        action: RoutingActionName;
        planId?: string;
        routeId?: string;
        stopId?: string;
        interventionId?: string;
        evidenceId?: string;
        reclamoId?: string;
        actorId?: string;
        previousStatus?: string;
        newStatus?: string;
        reason?: string;
        metadata?: Prisma.InputJsonValue;
      };
    }) => Promise<unknown>;
  };
};

@Injectable()
export class RoutingService {
  private readonly MAX_CLAIMS_PER_ROUTE = 20;
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject('NATS_CLIENT') private readonly natsClient: ClientProxy,
    private readonly routingPlannerContext: RoutingPlannerContext,
    private readonly routeLifecycleContext: RouteLifecycleContext,
  ) {}

  async upsertRules(payload: UpsertRoutingRulesDto) {
    const normalizedCrews = payload.crews.map((crew) => {
      const assigneeId = crew.userId ?? crew.crewId;
      if (!assigneeId) {
        throw new HttpException(
          'Cada regla de asignacion debe incluir userId o crewId',
          HttpStatus.BAD_REQUEST,
        );
      }

      return {
        crewId: assigneeId,
        nombre: crew.userName ?? crew.nombre ?? assigneeId,
        maxReclamosDiarios: Math.min(
          crew.maxReclamosDiarios,
          this.MAX_CLAIMS_PER_ROUTE,
        ),
        allowedCategorias: crew.allowedCategorias,
        allowedZoneIds: crew.allowedZoneIds ?? [],
        startLat: crew.startLat,
        startLng: crew.startLng,
      };
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.routingCategoryRule.deleteMany();
      await tx.routingCrewRule.deleteMany();
      await tx.routingZoneRule.deleteMany();

      if (payload.categoryRules.length > 0) {
        await tx.routingCategoryRule.createMany({
          data: payload.categoryRules.map((rule) => ({
            categoria: rule.categoria,
            cupoDiario: rule.cupoDiario,
            pesoPrioridad: rule.pesoPrioridad ?? 1,
          })),
        });
      }

      if (normalizedCrews.length > 0) {
        await tx.routingCrewRule.createMany({
          data: normalizedCrews,
        });
      }

      if ((payload.zones ?? []).length > 0) {
        await tx.routingZoneRule.createMany({
          data: (payload.zones ?? []).map((zone) => ({
            id: zone.id,
            nombre: zone.nombre,
            minLat: zone.minLat,
            maxLat: zone.maxLat,
            minLng: zone.minLng,
            maxLng: zone.maxLng,
          })),
        });
      }
    });

    return { status: 'ok', message: 'Reglas de ruteo actualizadas' };
  }

  async getRules(): Promise<{ status: 'ok'; data: RoutingRulesSnapshot }> {
    const [categoryRules, crews, zones] = await Promise.all([
      this.prisma.routingCategoryRule.findMany({
        orderBy: { categoria: 'asc' },
      }),
      this.prisma.routingCrewRule.findMany({ orderBy: { crewId: 'asc' } }),
      this.prisma.routingZoneRule.findMany({ orderBy: { id: 'asc' } }),
    ]);

    return {
      status: 'ok',
      data: {
        categoryRules: categoryRules.map((r) => ({
          categoria: r.categoria,
          cupoDiario: r.cupoDiario,
          pesoPrioridad: r.pesoPrioridad,
        })),
        crews: crews.map((c) => ({
          crewId: c.crewId,
          userId: c.crewId,
          nombre: c.nombre ?? c.crewId,
          userName: c.nombre ?? c.crewId,
          maxReclamosDiarios: c.maxReclamosDiarios,
          allowedCategorias: c.allowedCategorias,
          allowedZoneIds: c.allowedZoneIds,
          startLat: c.startLat,
          startLng: c.startLng,
        })),
        zones,
      },
    };
  }

  /** TTL for claim reservations: 60 minutes */
  private readonly RESERVATION_TTL_MS = 60 * 60 * 1000;

  async simulate(payload: SimulateRoutingDto) {
    return this.buildSimulation(payload, false, null);
  }

  async generate(payload: SimulateRoutingDto) {
    const idempotencyKey = payload.idempotencyKey ?? null;

    // --- Idempotency check ---
    if (idempotencyKey) {
      const existing = await this.prisma.routingGenerationRequest.findUnique({
        where: { idempotencyKey },
      });
      if (existing) {
        if (existing.status === 'completed' && existing.response) {
          this.logger.log(`Idempotency hit: ${idempotencyKey}`);
          return existing.response as object;
        }
        if (existing.status === 'processing') {
          throw new HttpException(
            'Esta generacion ya esta en proceso. Reintenta en unos segundos.',
            HttpStatus.CONFLICT,
          );
        }
      }
    }

    // --- Mark as processing ---
    const requestRecord = idempotencyKey
      ? await this.prisma.routingGenerationRequest.upsert({
          where: { idempotencyKey },
          create: { idempotencyKey, status: 'processing' },
          update: { status: 'processing', response: undefined },
        })
      : null;

    try {
      // --- Expire stale reservations before selecting candidates ---
      await this.expireStaleReservations();

      const result = await this.buildSimulation(
        payload,
        true,
        requestRecord?.id ?? null,
      );

      if (requestRecord && idempotencyKey) {
        await this.prisma.routingGenerationRequest.update({
          where: { idempotencyKey },
          data: {
            status: 'completed',
            response: result as unknown as Prisma.InputJsonValue,
            planId: result.savedPlanId ?? undefined,
          },
        });
      }

      return result;
    } catch (err) {
      if (requestRecord && idempotencyKey) {
        await this.prisma.routingGenerationRequest
          .update({
            where: { idempotencyKey },
            data: { status: 'failed' },
          })
          .catch(() => {
            /* swallow to surface original error */
          });
      }
      throw err;
    }
  }

  async getPlan(id: string) {
    const [plan, actionHistory] = await Promise.all([
      this.prisma.routingPlan.findUnique({
        where: { id },
        include: {
          routes: {
            include: {
              stops: {
                orderBy: { sequence: 'asc' },
              },
              interventions: {
                include: {
                  evidences: {
                    orderBy: { createdAt: 'asc' },
                  },
                },
                orderBy: { createdAt: 'asc' },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          unassigned: true,
        },
      }),
      this.prisma.routingActionHistory.findMany({
        where: { planId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    if (!plan) {
      throw new HttpException(
        'Plan de ruteo no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      status: 'ok',
      data: {
        id: plan.id,
        planningDate: plan.planningDate.toISOString(),
        status: plan.status,
        summary: plan.summary,
        routes: plan.routes,
        unassigned: plan.unassigned,
        actionHistory,
      },
    };
  }

  async listPlans() {
    const plans = await this.prisma.routingPlan.findMany({
      orderBy: [{ planningDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        routes: {
          select: {
            crewId: true,
            nombre: true,
            assignedClaims: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: {
          select: {
            routes: true,
            unassigned: true,
          },
        },
      },
      take: 50,
    });

    return {
      status: 'ok',
      data: plans.map((plan) => ({
        id: plan.id,
        planningDate: plan.planningDate.toISOString(),
        status: plan.status,
        createdAt: plan.createdAt.toISOString(),
        updatedAt: plan.updatedAt.toISOString(),
        totalRoutes: plan._count.routes,
        totalUnassigned: plan._count.unassigned,
        totalAssigned: plan.routes.reduce(
          (acc, route) => acc + route.assignedClaims,
          0,
        ),
        routes: plan.routes,
      })),
    };
  }

  async confirmPlan(id: string) {
    const plan = await this.prisma.routingPlan.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
    if (!plan) {
      throw new HttpException(
        'Plan de ruteo no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }
    if (plan.status === 'confirmed') {
      return { status: 'ok', message: 'Plan ya estaba confirmado' };
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // 1. Confirm plan + routes
      await tx.routingPlan.update({
        where: { id },
        data: { status: 'confirmed' },
      });
      await tx.routingRoute.updateMany({
        where: { planId: id },
        data: { status: 'assigned', assignedAt: now },
      });

      // 2. Get all claim IDs in this plan's stops
      const stops = await tx.routingStop.findMany({
        where: { route: { planId: id } },
        select: { reclamoId: true },
      });
      const claimIds = stops.map((s) => s.reclamoId);

      if (claimIds.length === 0) return;

      // 3. Mark allocations as assigned (upsert to handle missing rows)
      for (const claimId of claimIds) {
        await tx.routingClaimAllocation.upsert({
          where: { claimId },
          create: {
            claimId,
            state: 'assigned',
            assignedPlanId: id,
            assignedAt: now,
          },
          update: {
            state: 'assigned',
            assignedPlanId: id,
            assignedAt: now,
            reservationToken: null,
            reservedByPlanId: null,
            reservedAt: null,
            expiresAt: null,
          },
        });
      }

      // 4. Release any other reservations for these claims from OTHER plans
      await tx.routingClaimAllocation.updateMany({
        where: {
          claimId: { in: claimIds },
          state: 'reserved',
          reservedByPlanId: { not: id },
        },
        data: {
          state: 'available',
          reservationToken: null,
          reservedByPlanId: null,
          reservedAt: null,
          expiresAt: null,
        },
      });

      await this.recordAction(tx, {
        action: 'plan.confirmed',
        planId: id,
        previousStatus: plan.status,
        newStatus: 'confirmed',
        metadata: { claimCount: claimIds.length },
      });
    });

    return { status: 'ok', message: 'Plan confirmado correctamente' };
  }

  async deletePlan(id: string) {
    const exists = await this.prisma.routingPlan.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new HttpException(
        'Plan de ruteo no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      // Release any reservations held by this plan before deleting
      await tx.routingClaimAllocation.updateMany({
        where: { reservedByPlanId: id, state: 'reserved' },
        data: {
          state: 'available',
          reservationToken: null,
          reservedByPlanId: null,
          reservedAt: null,
          expiresAt: null,
        },
      });
      await tx.routingPlan.delete({ where: { id } });
    });

    return {
      status: 'ok',
      message: 'Plan de ruteo eliminado correctamente',
    };
  }

  async listAreaPlans() {
    const plans = await this.prisma.routingAreaPlan.findMany({
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      status: 'ok',
      data: plans,
    };
  }

  async getAreaPlan(id: string) {
    const plan = await this.prisma.routingAreaPlan.findUnique({
      where: { id },
    });
    if (!plan) {
      throw new HttpException(
        'Plan por area no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      status: 'ok',
      data: plan,
    };
  }

  async saveAreaPlan(payload: SaveRoutingAreaPlanDto) {
    const saved = payload.id
      ? await this.prisma.routingAreaPlan.upsert({
          where: { id: payload.id },
          update: {
            name: payload.name,
            userId: payload.userId,
            userName: payload.userName,
            categorias: payload.categorias,
            originAddress: payload.originAddress,
            originLat: payload.originLat,
            originLng: payload.originLng,
            dailyByUser: Math.min(
              payload.dailyByUser,
              this.MAX_CLAIMS_PER_ROUTE,
            ),
            dailyByCategory: Math.min(
              payload.dailyByCategory,
              this.MAX_CLAIMS_PER_ROUTE,
            ),
          },
          create: {
            id: payload.id,
            name: payload.name,
            userId: payload.userId,
            userName: payload.userName,
            categorias: payload.categorias,
            originAddress: payload.originAddress,
            originLat: payload.originLat,
            originLng: payload.originLng,
            dailyByUser: Math.min(
              payload.dailyByUser,
              this.MAX_CLAIMS_PER_ROUTE,
            ),
            dailyByCategory: Math.min(
              payload.dailyByCategory,
              this.MAX_CLAIMS_PER_ROUTE,
            ),
          },
        })
      : await this.prisma.routingAreaPlan.create({
          data: {
            name: payload.name,
            userId: payload.userId,
            userName: payload.userName,
            categorias: payload.categorias,
            originAddress: payload.originAddress,
            originLat: payload.originLat,
            originLng: payload.originLng,
            dailyByUser: Math.min(
              payload.dailyByUser,
              this.MAX_CLAIMS_PER_ROUTE,
            ),
            dailyByCategory: Math.min(
              payload.dailyByCategory,
              this.MAX_CLAIMS_PER_ROUTE,
            ),
          },
        });

    return {
      status: 'ok',
      data: saved,
    };
  }

  async deleteAreaPlan(id: string) {
    const exists = await this.prisma.routingAreaPlan.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new HttpException(
        'Plan por area no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.routingAreaPlan.delete({ where: { id } });

    return {
      status: 'ok',
      message: 'Plan por area eliminado correctamente',
    };
  }

  async getAssignedRoute(payload: GetAssignedRouteDto) {
    const assigneeId = payload.userId ?? payload.crewId;
    if (!assigneeId) {
      throw new HttpException(
        'Debe enviar userId o crewId',
        HttpStatus.BAD_REQUEST,
      );
    }

    const route = await this.prisma.routingRoute.findFirst({
      where: {
        crewId: assigneeId,
        status: {
          in: ['assigned', 'in_progress'],
        },
        plan: payload.planningDate
          ? {
              planningDate: new Date(`${payload.planningDate}T00:00:00.000Z`),
            }
          : undefined,
      },
      include: {
        plan: {
          select: {
            id: true,
            planningDate: true,
            status: true,
          },
        },
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            intervention: {
              include: {
                evidences: {
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: [{ plan: { planningDate: 'desc' } }, { createdAt: 'desc' }],
    });

    if (!route) {
      throw new HttpException(
        'No se encontro una ruta asignada para el usuario/cuadrilla indicado',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      status: 'ok',
      data: route,
    };
  }

  async updateRouteStatus(payload: UpdateRouteStatusDto) {
    const route = await this.prisma.routingRoute.findUnique({
      where: { id: payload.routeId },
      select: {
        id: true,
        crewId: true,
        status: true,
        startedAt: true,
      },
    });

    if (!route) {
      throw new HttpException('Ruta no encontrada', HttpStatus.NOT_FOUND);
    }

    if (
      payload.actorId &&
      !payload.actorIsAdmin &&
      route.crewId !== payload.actorId
    ) {
      throw new ForbiddenException('El actor no pertenece a la ruta indicada');
    }

    const now = new Date();
    const data = this.routeLifecycleContext.transition({
      currentStatus: route.status as RoutingRouteStatus,
      targetStatus: payload.status,
      startedAt: route.startedAt,
      now,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.routingRoute.update({
        where: { id: payload.routeId },
        data,
      });

      await this.recordAction(tx, {
        action: 'route.status_changed',
        routeId: payload.routeId,
        previousStatus: route.status,
        newStatus: data.status,
      });
    });

    return {
      status: 'ok',
      message: 'Estado de ruta actualizado',
    };
  }

  async registerIntervention(payload: RegisterInterventionDto) {
    const stop = await this.prisma.routingStop.findUnique({
      where: { id: payload.stopId },
      include: {
        route: true,
      },
    });

    if (!stop) {
      throw new HttpException(
        'Punto de ruta no encontrado',
        HttpStatus.NOT_FOUND,
      );
    }

    if (stop.routeId !== payload.routeId) {
      throw new HttpException(
        'El punto indicado no pertenece a la ruta',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      payload.actorId &&
      !payload.actorIsAdmin &&
      stop.route.crewId !== payload.actorId
    ) {
      throw new ForbiddenException('El actor no pertenece a la ruta indicada');
    }

    const now = new Date();
    const nextStopStatus = this.resolveStopStatusByIntervention(payload.result);
    const nextClaimStatus = this.resolveClaimStatusByIntervention(
      payload.result,
    );

    const intervention = await this.prisma.$transaction(async (tx) => {
      const updatedIntervention = await tx.routingIntervention.upsert({
        where: { stopId: payload.stopId },
        create: {
          routeId: payload.routeId,
          stopId: payload.stopId,
          reclamoId: stop.reclamoId,
          result: payload.result,
          observation: payload.observation,
          performedBy: payload.performedBy,
          performedAt: now,
        },
        update: {
          result: payload.result,
          observation: payload.observation,
          performedBy: payload.performedBy,
          performedAt: now,
        },
        include: {
          evidences: {
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      await tx.routingStop.update({
        where: { id: payload.stopId },
        data: {
          status: nextStopStatus,
          visitedAt: now,
        },
      });

      if (stop.route.status === 'assigned') {
        const startTransition = this.routeLifecycleContext.transition({
          currentStatus: stop.route.status,
          targetStatus: 'in_progress',
          startedAt: stop.route.startedAt,
          now,
        });

        await tx.routingRoute.update({
          where: { id: stop.routeId },
          data: startTransition,
        });
      }

      const pendingStops = await tx.routingStop.count({
        where: {
          routeId: stop.routeId,
          status: 'pendiente',
        },
      });

      if (pendingStops === 0) {
        const effectiveStartedAt =
          stop.route.status === 'assigned'
            ? (stop.route.startedAt ?? now)
            : stop.route.startedAt;

        const completedTransition = this.routeLifecycleContext.transition({
          currentStatus:
            stop.route.status === 'assigned'
              ? 'in_progress'
              : (stop.route.status as RoutingRouteStatus),
          targetStatus: 'completed',
          startedAt: effectiveStartedAt,
          now,
        });

        await tx.routingRoute.update({
          where: { id: stop.routeId },
          data: completedTransition,
        });
      }

      await this.recordAction(tx, {
        action: 'intervention.registered',
        routeId: payload.routeId,
        stopId: payload.stopId,
        interventionId: updatedIntervention.id,
        reclamoId: stop.reclamoId,
        actorId: payload.performedBy,
        previousStatus: stop.status,
        newStatus: nextStopStatus,
        reason: payload.observation,
        metadata: {
          result: payload.result,
          claimStatus: nextClaimStatus,
        },
      });

      return updatedIntervention;
    });

    await this.syncClaimFromIntervention(
      stop.reclamoId,
      nextClaimStatus,
      payload,
      intervention.id,
    );

    return {
      status: 'ok',
      message: 'Intervencion registrada correctamente',
      data: intervention,
    };
  }

  async attachInterventionEvidence(payload: AttachInterventionEvidenceDto) {
    const intervention = await this.prisma.routingIntervention.findUnique({
      where: { id: payload.interventionId },
      select: {
        id: true,
        reclamoId: true,
        route: {
          select: { crewId: true },
        },
      },
    });

    if (!intervention) {
      throw new HttpException(
        'Intervencion no encontrada',
        HttpStatus.NOT_FOUND,
      );
    }

    if (
      payload.actorId &&
      !payload.actorIsAdmin &&
      intervention.route.crewId !== payload.actorId
    ) {
      throw new ForbiddenException(
        'El actor no pertenece a la ruta de la intervencion',
      );
    }

    const evidence = await this.prisma.$transaction(async (tx) => {
      const createdEvidence = await tx.routingInterventionEvidence.create({
        data: {
          interventionId: payload.interventionId,
          tipo: payload.tipo,
          nombreArchivo: payload.nombreArchivo,
          urlArchivo: payload.urlArchivo,
          descripcion: payload.descripcion,
        },
      });

      await this.recordAction(tx, {
        action: 'evidence.attached',
        interventionId: intervention.id,
        evidenceId: createdEvidence.id,
        reclamoId: intervention.reclamoId,
        reason: payload.descripcion,
        metadata: {
          tipo: payload.tipo,
          nombreArchivo: payload.nombreArchivo,
        },
      });

      return createdEvidence;
    });

    await this.syncClaimEvidenceObservation(
      intervention.reclamoId,
      payload,
      evidence.createdAt,
      evidence.id,
    );

    return {
      status: 'ok',
      message: 'Evidencia adjuntada correctamente',
      data: evidence,
    };
  }

  private async expireStaleReservations() {
    await this.prisma.routingClaimAllocation.updateMany({
      where: {
        state: 'reserved',
        expiresAt: { lt: new Date() },
      },
      data: {
        state: 'available',
        reservationToken: null,
        reservedByPlanId: null,
        reservedAt: null,
        expiresAt: null,
      },
    });
  }

  private async buildSimulation(
    payload: SimulateRoutingDto,
    forcePersist: boolean,
    generationRequestId: string | null,
  ) {
    const maxFetch = payload.maxFetch ?? 200;
    const planningDate =
      payload.planningDate ?? new Date().toISOString().slice(0, 10);
    const useGoogleOptimization = payload.useGoogleOptimization ?? true;
    const persistPlan = forcePersist || payload.persistPlan === true;

    const rules = payload.overrideRules
      ? this.toRulesSnapshot(payload.overrideRules)
      : (await this.getRules()).data;
    if (!rules.crews.length || !rules.categoryRules.length) {
      throw new HttpException(
        'No hay reglas de ruteo configuradas (categoryRules/crews)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const selectionFilters = this.resolveSelectionFilters(payload, rules);
    const fetchedClaims = await this.fetchClaims(maxFetch, selectionFilters);

    // Exclude claims already assigned to a confirmed plan or actively reserved by another run
    const blockedClaimIds = forcePersist
      ? await this.getBlockedClaimIds()
      : new Set<string>();

    const validClaims = fetchedClaims.filter(
      (c) =>
        Number.isFinite(c.lat) &&
        Number.isFinite(c.lng) &&
        !blockedClaimIds.has(c.id),
    );

    const zoneByClaimId = new Map<string, string | null>();
    for (const claim of validClaims) {
      const zoneId = this.findZoneForClaim(
        claim.lat,
        claim.lng,
        rules.zones ?? [],
      );
      zoneByClaimId.set(claim.id, zoneId);
    }

    const categoryQuota = new Map<string, number>();
    const categoryPriorityWeight = new Map<string, number>();
    for (const rule of rules.categoryRules) {
      categoryQuota.set(rule.categoria, rule.cupoDiario);
      categoryPriorityWeight.set(rule.categoria, rule.pesoPrioridad ?? 1);
    }

    const categoryConsumption: Record<string, number> = {};
    const unassignedByReason: Record<string, number> = {};

    const prioritizedClaims = [...validClaims].sort((a, b) => {
      const pDiff =
        this.priorityScore(b, categoryPriorityWeight) -
        this.priorityScore(a, categoryPriorityWeight);
      if (pDiff !== 0) {
        return pDiff;
      }
      return a.id.localeCompare(b.id);
    });

    const routeBuilders = rules.crews.map((crew) => ({
      crew,
      claims: [] as ReclamoItem[],
    }));
    const unassigned: Array<{ reclamoId: string; reason: string }> = [];

    for (const claim of prioritizedClaims) {
      const quota = categoryQuota.get(claim.categoria) ?? 0;
      const consumed = categoryConsumption[claim.categoria] ?? 0;

      if (consumed >= quota) {
        this.pushUnassigned(
          unassigned,
          unassignedByReason,
          claim.id,
          'category_quota_reached',
        );
        continue;
      }

      const zoneId = zoneByClaimId.get(claim.id) ?? null;
      const candidates = routeBuilders.filter((r) => {
        if (!r.crew.allowedCategorias.includes(claim.categoria)) {
          return false;
        }
        if (r.claims.length >= r.crew.maxReclamosDiarios) {
          return false;
        }
        if (r.crew.allowedZoneIds.length > 0) {
          return !!zoneId && r.crew.allowedZoneIds.includes(zoneId);
        }
        return true;
      });

      if (!candidates.length) {
        this.pushUnassigned(
          unassigned,
          unassignedByReason,
          claim.id,
          'no_eligible_crew',
        );
        continue;
      }

      candidates.sort((a, b) => a.claims.length - b.claims.length);
      candidates[0].claims.push(claim);
      categoryConsumption[claim.categoria] = consumed + 1;
    }

    let routes: RouteDraft[] = routeBuilders
      .filter((r) => r.claims.length > 0)
      .map((builder) =>
        this.buildRoute(
          builder.crew,
          builder.claims,
          zoneByClaimId,
          categoryPriorityWeight,
          payload.originLat,
          payload.originLng,
        ),
      );

    let optimizedRoutes = 0;
    let failedRoutes = 0;

    if (useGoogleOptimization) {
      const optimizedResult = await this.routingPlannerContext.optimize(
        routes,
        {
          useGoogleOptimization,
          originLat: payload.originLat,
          originLng: payload.originLng,
        },
      );
      routes = optimizedResult.routes;
      optimizedRoutes = optimizedResult.optimizedRoutes;
      failedRoutes = optimizedResult.failedRoutes;
    }

    const totalAssigned = routes.reduce(
      (acc, route) => acc + route.assignedClaims,
      0,
    );

    const summary: SimulationSummary = {
      totalFetched: fetchedClaims.length,
      totalCandidateAfterRules: validClaims.length,
      totalAssigned,
      totalUnassigned: unassigned.length,
      unassignedByReason,
      categoryQuotaConsumption: categoryConsumption,
      googleOptimization: {
        enabled: useGoogleOptimization,
        optimizedRoutes,
        failedRoutes,
      },
    };

    let savedPlanId: string | null = null;
    if (persistPlan) {
      const assignedClaimIds = routes.flatMap((r) =>
        r.stops.map((s) => s.reclamoId),
      );
      const plan = await this.persistPlanWithReservation(
        planningDate,
        summary,
        routes,
        unassigned,
        assignedClaimIds,
        generationRequestId,
      );
      savedPlanId = plan.id;
    }

    return {
      status: 'ok',
      generatedAt: new Date().toISOString(),
      planningDate,
      summary,
      routes,
      unassigned,
      savedPlanId,
    };
  }

  private async fetchClaims(
    maxFetch: number,
    filters: ClaimSelectionFilters,
  ): Promise<ReclamoItem[]> {
    const claims: ReclamoItem[] = [];
    const limitPerPage = 100;
    let page = 1;
    const remoteFilters = this.toRemoteClaimFilters(filters);

    while (claims.length < maxFetch) {
      const limit = Math.min(limitPerPage, maxFetch - claims.length);
      const response = await firstValueFrom(
        this.natsClient
          .send<ReclamosFindAllResponse>('reclamos.find-all', {
            page,
            limit,
            sortDirection: -1,
            ...remoteFilters,
          })
          .pipe(timeout(12000)),
      );

      const fetchedItems = response?.items ?? [];
      if (!fetchedItems.length) {
        break;
      }

      const items = fetchedItems.filter((item) =>
        this.matchesSelectionFilters(item, filters),
      );

      claims.push(
        ...items.map((it) => ({
          id: it.id,
          categoria: it.categoria,
          prioridad: it.prioridad,
          lat: Number(it.lat),
          lng: Number(it.lng),
          direccion: it.direccion ?? 'Sin direccion',
        })),
      );

      if (!response.pagination?.hasNextPage) {
        break;
      }

      page += 1;
    }

    return claims;
  }

  private resolveSelectionFilters(
    payload: SimulateRoutingDto,
    rules: RoutingRulesSnapshot,
  ): ClaimSelectionFilters {
    return {
      statuses: payload.claimStatuses ?? [],
      priorities: payload.priorities ?? [],
      categories:
        payload.categories ??
        rules.categoryRules.map(
          (rule) => rule.categoria as ReclamoItem['categoria'],
        ),
      municipalityId: payload.municipalityId,
      areaId: payload.areaId,
    };
  }

  private toRemoteClaimFilters(filters: ClaimSelectionFilters): {
    estado?: ClaimSelectionFilters['statuses'][number];
    categoria?: ReclamoItem['categoria'];
    prioridad?: ReclamoItem['prioridad'];
    municipalityId?: string;
    areaId?: string;
  } {
    return {
      estado: filters.statuses.length === 1 ? filters.statuses[0] : undefined,
      categoria:
        filters.categories.length === 1 ? filters.categories[0] : undefined,
      prioridad:
        filters.priorities.length === 1 ? filters.priorities[0] : undefined,
      municipalityId: filters.municipalityId,
      areaId: filters.areaId,
    };
  }

  private matchesSelectionFilters(
    claim: ReclamoRoutingResponse,
    filters: ClaimSelectionFilters,
  ): boolean {
    if (filters.statuses.length > 0 && claim.estado) {
      if (!filters.statuses.includes(claim.estado)) {
        return false;
      }
    }

    if (
      filters.categories.length > 0 &&
      !filters.categories.includes(claim.categoria)
    ) {
      return false;
    }

    if (
      filters.priorities.length > 0 &&
      !filters.priorities.includes(claim.prioridad)
    ) {
      return false;
    }

    if (
      filters.municipalityId &&
      claim.municipalityId !== filters.municipalityId
    ) {
      return false;
    }

    if (filters.areaId && claim.areaId !== filters.areaId) {
      return false;
    }

    return true;
  }

  private toRulesSnapshot(rules: UpsertRoutingRulesDto): RoutingRulesSnapshot {
    return {
      categoryRules: rules.categoryRules,
      crews: rules.crews.map((crew) => ({
        crewId: crew.crewId ?? crew.userId ?? '',
        userId: crew.userId,
        nombre: crew.nombre,
        userName: crew.userName,
        maxReclamosDiarios: crew.maxReclamosDiarios,
        allowedCategorias: crew.allowedCategorias,
        allowedZoneIds: crew.allowedZoneIds ?? [],
        startLat: crew.startLat,
        startLng: crew.startLng,
      })),
      zones: rules.zones ?? [],
    };
  }

  private buildRoute(
    crew: {
      crewId: string;
      nombre?: string | null;
      maxReclamosDiarios: number;
      startLat?: number | null;
      startLng?: number | null;
    },
    claims: ReclamoItem[],
    zoneByClaimId: Map<string, string | null>,
    categoryPriorityWeight: Map<string, number>,
    originLat?: number,
    originLng?: number,
  ) {
    const sorted = [...claims].sort(
      (a, b) =>
        this.priorityScore(b, categoryPriorityWeight) -
        this.priorityScore(a, categoryPriorityWeight),
    );

    let prevLat = crew.startLat ?? originLat ?? sorted[0].lat;
    let prevLng = crew.startLng ?? originLng ?? sorted[0].lng;
    let totalDistance = 0;
    let totalDuration = 0;

    const stops = sorted.map((claim, index) => {
      const distance =
        index === 0
          ? 0
          : this.haversineKm(prevLat, prevLng, claim.lat, claim.lng);
      const duration =
        index === 0 ? 0 : Math.max(1, Math.round((distance / 30) * 60));

      totalDistance += distance;
      totalDuration += duration;

      prevLat = claim.lat;
      prevLng = claim.lng;

      return {
        sequence: index + 1,
        reclamoId: claim.id,
        categoria: claim.categoria,
        prioridad: claim.prioridad,
        zoneId: zoneByClaimId.get(claim.id) ?? null,
        lat: claim.lat,
        lng: claim.lng,
        direccion: claim.direccion,
        distanceFromPreviousKm: Number(distance.toFixed(3)),
        durationFromPreviousMin: duration,
        createdAt: new Date().toISOString(),
      };
    });

    return {
      crewId: crew.crewId,
      nombre: crew.nombre ?? crew.crewId,
      assignedClaims: sorted.length,
      maxReclamosDiarios: crew.maxReclamosDiarios,
      totalDistanceKm: Number(totalDistance.toFixed(3)),
      totalDurationMin: totalDuration,
      stops,
    };
  }

  /** Returns Set of claimIds that are either assigned to a confirmed plan
   *  or actively reserved (not expired) by another in-flight generation. */
  private async getBlockedClaimIds(): Promise<Set<string>> {
    const rows = await this.prisma.routingClaimAllocation.findMany({
      where: {
        OR: [
          { state: 'assigned' },
          {
            state: 'reserved',
            expiresAt: { gt: new Date() },
          },
        ],
      },
      select: { claimId: true },
    });
    return new Set(rows.map((r) => r.claimId));
  }

  private async persistPlanWithReservation(
    planningDate: string,
    summary: SimulationSummary,
    routes: Array<{
      crewId: string;
      nombre: string;
      assignedClaims: number;
      maxReclamosDiarios: number;
      totalDistanceKm: number;
      totalDurationMin: number;
      stops: Array<{
        sequence: number;
        reclamoId: string;
        categoria: string;
        prioridad: string;
        zoneId: string | null;
        lat: number;
        lng: number;
        direccion: string;
        distanceFromPreviousKm: number;
        durationFromPreviousMin: number;
        createdAt: string;
      }>;
    }>,
    unassigned: Array<{ reclamoId: string; reason: string }>,
    assignedClaimIds: string[],
    generationRequestId: string | null,
  ) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.RESERVATION_TTL_MS);
    const reservationToken = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    return this.prisma.$transaction(async (tx) => {
      // 1. Persist the plan
      const plan = await tx.routingPlan.create({
        data: {
          planningDate: new Date(`${planningDate}T00:00:00.000Z`),
          status: 'proposed',
          summary: summary as unknown as Prisma.InputJsonValue,
          routes: {
            create: routes.map((route) => ({
              crewId: route.crewId,
              nombre: route.nombre,
              status: 'assigned',
              assignedClaims: route.assignedClaims,
              maxReclamosDiarios: route.maxReclamosDiarios,
              totalDistanceKm: route.totalDistanceKm,
              totalDurationMin: route.totalDurationMin,
              stops: {
                create: route.stops.map((stop) => ({
                  sequence: stop.sequence,
                  status: 'pendiente',
                  reclamoId: stop.reclamoId,
                  categoria: stop.categoria,
                  prioridad: stop.prioridad,
                  zoneId: stop.zoneId,
                  lat: stop.lat,
                  lng: stop.lng,
                  direccion: stop.direccion,
                  distanceFromPreviousKm: stop.distanceFromPreviousKm,
                  durationFromPreviousMin: stop.durationFromPreviousMin,
                  createdAt: new Date(stop.createdAt),
                })),
              },
            })),
          },
          unassigned: {
            create: unassigned.map((u) => ({
              reclamoId: u.reclamoId,
              reason: u.reason,
            })),
          },
        },
        select: { id: true },
      });

      // 2. Verify no claim was already assigned or reserved by another run.
      const conflicts = assignedClaimIds.length
        ? await tx.routingClaimAllocation.findMany({
            where: {
              claimId: { in: assignedClaimIds },
              OR: [
                { state: 'assigned' },
                {
                  state: 'reserved',
                  expiresAt: { gt: now },
                },
              ],
            },
            select: { claimId: true },
          })
        : [];

      if (conflicts.length > 0) {
        throw new HttpException(
          `${conflicts.length} reclamo(s) ya fueron asignados o reservados por otro plan. Regenera la corrida para obtener candidatos actualizados.`,
          HttpStatus.CONFLICT,
        );
      }

      // 3. Reserve each assigned claim atomically
      // Only reserve claims that are currently 'available' (not already assigned/reserved)
      for (const claimId of assignedClaimIds) {
        await tx.routingClaimAllocation.upsert({
          where: { claimId },
          create: {
            claimId,
            state: 'reserved',
            reservationToken,
            reservedByPlanId: plan.id,
            reservedAt: now,
            expiresAt,
          },
          update: {
            // Only overwrite if still available (state check done below)
            state: 'reserved',
            reservationToken,
            reservedByPlanId: plan.id,
            reservedAt: now,
            expiresAt,
          },
        });
      }

      // 4. Link request record to plan if provided
      if (generationRequestId) {
        await tx.routingGenerationRequest.update({
          where: { id: generationRequestId },
          data: { planId: plan.id },
        });
      }

      await this.recordAction(tx, {
        action: 'plan.generated',
        planId: plan.id,
        newStatus: 'proposed',
        metadata: {
          planningDate,
          routeCount: routes.length,
          assignedClaimCount: assignedClaimIds.length,
          unassignedCount: unassigned.length,
        },
      });

      return plan;
    });
  }

  private async persistPlan(
    planningDate: string,
    summary: SimulationSummary,
    routes: Array<{
      crewId: string;
      nombre: string;
      assignedClaims: number;
      maxReclamosDiarios: number;
      totalDistanceKm: number;
      totalDurationMin: number;
      stops: Array<{
        sequence: number;
        reclamoId: string;
        categoria: string;
        prioridad: string;
        zoneId: string | null;
        lat: number;
        lng: number;
        direccion: string;
        distanceFromPreviousKm: number;
        durationFromPreviousMin: number;
        createdAt: string;
      }>;
    }>,
    unassigned: Array<{ reclamoId: string; reason: string }>,
  ) {
    return this.prisma.routingPlan.create({
      data: {
        planningDate: new Date(`${planningDate}T00:00:00.000Z`),
        status: 'proposed',
        summary: summary as unknown as Prisma.InputJsonValue,
        routes: {
          create: routes.map((route) => ({
            crewId: route.crewId,
            nombre: route.nombre,
            status: 'assigned',
            assignedClaims: route.assignedClaims,
            maxReclamosDiarios: route.maxReclamosDiarios,
            totalDistanceKm: route.totalDistanceKm,
            totalDurationMin: route.totalDurationMin,
            stops: {
              create: route.stops.map((stop) => ({
                sequence: stop.sequence,
                status: 'pendiente',
                reclamoId: stop.reclamoId,
                categoria: stop.categoria,
                prioridad: stop.prioridad,
                zoneId: stop.zoneId,
                lat: stop.lat,
                lng: stop.lng,
                direccion: stop.direccion,
                distanceFromPreviousKm: stop.distanceFromPreviousKm,
                durationFromPreviousMin: stop.durationFromPreviousMin,
                createdAt: new Date(stop.createdAt),
              })),
            },
          })),
        },
        unassigned: {
          create: unassigned.map((u) => ({
            reclamoId: u.reclamoId,
            reason: u.reason,
          })),
        },
      },
      select: { id: true },
    });
  }

  private resolveStopStatusByIntervention(
    result: InterventionResult,
  ): RoutingStopStatus {
    if (result === 'resuelto') {
      return 'visitado';
    }

    if (result === 'no_corresponde') {
      return 'omitido';
    }

    if (result === 'requiere_nueva_visita') {
      return 'reprogramado';
    }

    return 'visitado';
  }

  private resolveClaimStatusByIntervention(
    result: InterventionResult,
  ): 'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado' | 'cerrado' {
    if (result === 'resuelto') {
      return 'resuelto';
    }

    if (result === 'no_corresponde') {
      return 'rechazado';
    }

    return 'en_proceso';
  }

  private async syncClaimFromIntervention(
    reclamoId: string,
    estado: 'pendiente' | 'en_proceso' | 'resuelto' | 'rechazado' | 'cerrado',
    payload: RegisterInterventionDto,
    interventionId: string,
  ): Promise<void> {
    const observationText = [
      `Intervencion de ruta: ${payload.result}`,
      payload.observation?.trim()
        ? `Detalle: ${payload.observation.trim()}`
        : null,
      payload.performedBy?.trim()
        ? `Ejecutado por: ${payload.performedBy.trim()}`
        : null,
    ]
      .filter(Boolean)
      .join(' | ');

    await firstValueFrom(
      this.natsClient
        .send('reclamos.update', {
          id: reclamoId,
          data: {
            estado,
            observaciones: observationText,
            actorId: payload.actorId ?? payload.performedBy,
            origen: 'routing',
            referenciaId: interventionId,
          },
        })
        .pipe(timeout(12000)),
    );
  }

  private async syncClaimEvidenceObservation(
    reclamoId: string,
    payload: AttachInterventionEvidenceDto,
    createdAt: Date,
    evidenceId: string,
  ): Promise<void> {
    const observation =
      `Evidencia adjuntada (${payload.tipo}) - ${payload.nombreArchivo} - ` +
      `${payload.urlArchivo} - ${createdAt.toISOString()}`;

    await firstValueFrom(
      this.natsClient
        .send('reclamos.update', {
          id: reclamoId,
          data: {
            observaciones: observation,
            actorId: payload.actorId,
            origen: 'routing',
            referenciaId: evidenceId,
          },
        })
        .pipe(timeout(12000)),
    );
  }

  private findZoneForClaim(
    lat: number,
    lng: number,
    zones: Array<{
      id: string;
      minLat: number;
      maxLat: number;
      minLng: number;
      maxLng: number;
    }>,
  ): string | null {
    for (const zone of zones) {
      if (
        lat >= zone.minLat &&
        lat <= zone.maxLat &&
        lng >= zone.minLng &&
        lng <= zone.maxLng
      ) {
        return zone.id;
      }
    }
    return null;
  }

  private priorityWeight(priority: ClaimPrioridad): number {
    if (priority === 'alta') return 3;
    if (priority === 'media') return 2;
    return 1;
  }

  private priorityScore(
    claim: Pick<ReclamoItem, 'categoria' | 'prioridad'>,
    categoryPriorityWeight: Map<string, number>,
  ): number {
    return (
      this.priorityWeight(claim.prioridad) *
      (categoryPriorityWeight.get(claim.categoria) ?? 1)
    );
  }

  private async recordAction(
    writer: RoutingHistoryWriter,
    params: {
      action: RoutingActionName;
      planId?: string;
      routeId?: string;
      stopId?: string;
      interventionId?: string;
      evidenceId?: string;
      reclamoId?: string;
      actorId?: string;
      previousStatus?: string | null;
      newStatus?: string | null;
      reason?: string | null;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await writer.routingActionHistory.create({
      data: {
        action: params.action,
        planId: params.planId,
        routeId: params.routeId,
        stopId: params.stopId,
        interventionId: params.interventionId,
        evidenceId: params.evidenceId,
        reclamoId: params.reclamoId,
        actorId: params.actorId,
        previousStatus: params.previousStatus ?? undefined,
        newStatus: params.newStatus ?? undefined,
        reason: params.reason ?? undefined,
        metadata: params.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private haversineKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const r = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return r * c;
  }

  private pushUnassigned(
    unassigned: Array<{ reclamoId: string; reason: string }>,
    unassignedByReason: Record<string, number>,
    reclamoId: string,
    reason: string,
  ) {
    unassigned.push({ reclamoId, reason });
    unassignedByReason[reason] = (unassignedByReason[reason] ?? 0) + 1;
  }
}
