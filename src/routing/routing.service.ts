import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../prisma/prisma.service';
import { SimulateRoutingDto } from './dto/simulate-routing.dto';
import { UpsertRoutingRulesDto } from './dto/upsert-routing-rules.dto';
import { GetAssignedRouteDto } from './dto/get-assigned-route.dto';
import { UpdateRouteStatusDto } from './dto/update-route-status.dto';
import { RegisterInterventionDto } from './dto/register-intervention.dto';
import { AttachInterventionEvidenceDto } from './dto/attach-intervention-evidence.dto';
import { SaveRoutingAreaPlanDto } from './dto/save-routing-area-plan.dto';
import {
  ClaimCategoria,
  ClaimPrioridad,
  InterventionResult,
  ReclamoItem,
  RoutingRouteStatus,
  RoutingStopStatus,
  SimulationSummary,
} from './routing.types';
import { firstValueFrom, timeout } from 'rxjs';

@Injectable()
export class RoutingService {
  private readonly MAX_CLAIMS_PER_ROUTE = 20;
  private readonly logger = new Logger(RoutingService.name);
  private readonly googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY ?? '';

  constructor(
    private readonly prisma: PrismaService,
    @Inject('NATS_CLIENT') private readonly natsClient: ClientProxy,
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
        maxReclamosDiarios: Math.min(crew.maxReclamosDiarios, this.MAX_CLAIMS_PER_ROUTE),
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

  async getRules() {
    const [categoryRules, crews, zones] = await Promise.all([
      this.prisma.routingCategoryRule.findMany({ orderBy: { categoria: 'asc' } }),
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
        zones: zones,
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

      const result = await this.buildSimulation(payload, true, requestRecord?.id ?? null);

      if (requestRecord && idempotencyKey) {
        await this.prisma.routingGenerationRequest.update({
          where: { idempotencyKey },
          data: { status: 'completed', response: result as unknown as object, planId: result.savedPlanId ?? undefined },
        });
      }

      return result;
    } catch (err) {
      if (requestRecord && idempotencyKey) {
        await this.prisma.routingGenerationRequest.update({
          where: { idempotencyKey },
          data: { status: 'failed' },
        }).catch(() => { /* swallow to surface original error */ });
      }
      throw err;
    }
  }

  async getPlan(id: string) {
    const plan = await this.prisma.routingPlan.findUnique({
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
    });

    if (!plan) {
      throw new HttpException('Plan de ruteo no encontrado', HttpStatus.NOT_FOUND);
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
        totalAssigned: plan.routes.reduce((acc, route) => acc + route.assignedClaims, 0),
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
      throw new HttpException('Plan de ruteo no encontrado', HttpStatus.NOT_FOUND);
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
    });

    return { status: 'ok', message: 'Plan confirmado correctamente' };
  }

  async deletePlan(id: string) {
    const exists = await this.prisma.routingPlan.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new HttpException('Plan de ruteo no encontrado', HttpStatus.NOT_FOUND);
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
    const plan = await this.prisma.routingAreaPlan.findUnique({ where: { id } });
    if (!plan) {
      throw new HttpException('Plan por area no encontrado', HttpStatus.NOT_FOUND);
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
            dailyByUser: Math.min(payload.dailyByUser, this.MAX_CLAIMS_PER_ROUTE),
            dailyByCategory: Math.min(payload.dailyByCategory, this.MAX_CLAIMS_PER_ROUTE),
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
            dailyByUser: Math.min(payload.dailyByUser, this.MAX_CLAIMS_PER_ROUTE),
            dailyByCategory: Math.min(payload.dailyByCategory, this.MAX_CLAIMS_PER_ROUTE),
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
            dailyByUser: Math.min(payload.dailyByUser, this.MAX_CLAIMS_PER_ROUTE),
            dailyByCategory: Math.min(payload.dailyByCategory, this.MAX_CLAIMS_PER_ROUTE),
          },
        });

    return {
      status: 'ok',
      data: saved,
    };
  }

  async deleteAreaPlan(id: string) {
    const exists = await this.prisma.routingAreaPlan.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new HttpException('Plan por area no encontrado', HttpStatus.NOT_FOUND);
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
      throw new HttpException('Debe enviar userId o crewId', HttpStatus.BAD_REQUEST);
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
        status: true,
      },
    });

    if (!route) {
      throw new HttpException('Ruta no encontrada', HttpStatus.NOT_FOUND);
    }

    const now = new Date();
    const data: {
      status: RoutingRouteStatus;
      startedAt?: Date | null;
      completedAt?: Date | null;
    } = {
      status: payload.status,
    };

    if (payload.status === 'in_progress') {
      data.startedAt = route.status === 'in_progress' ? undefined : now;
      data.completedAt = null;
    }

    if (payload.status === 'completed') {
      data.completedAt = now;
      if (route.status !== 'in_progress') {
        data.startedAt = route.status === 'assigned' ? now : undefined;
      }
    }

    if (payload.status === 'assigned') {
      data.startedAt = null;
      data.completedAt = null;
    }

    if (payload.status === 'cancelled') {
      data.completedAt = now;
    }

    await this.prisma.routingRoute.update({
      where: { id: payload.routeId },
      data,
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
      throw new HttpException('Punto de ruta no encontrado', HttpStatus.NOT_FOUND);
    }

    if (stop.routeId !== payload.routeId) {
      throw new HttpException('El punto indicado no pertenece a la ruta', HttpStatus.BAD_REQUEST);
    }

    const now = new Date();
    const nextStopStatus = this.resolveStopStatusByIntervention(payload.result);
    const nextClaimStatus = this.resolveClaimStatusByIntervention(payload.result);

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
        await tx.routingRoute.update({
          where: { id: stop.routeId },
          data: {
            status: 'in_progress',
            startedAt: stop.route.startedAt ?? now,
          },
        });
      }

      const pendingStops = await tx.routingStop.count({
        where: {
          routeId: stop.routeId,
          status: 'pendiente',
        },
      });

      if (pendingStops === 0) {
        await tx.routingRoute.update({
          where: { id: stop.routeId },
          data: {
            status: 'completed',
            completedAt: now,
          },
        });
      }

      return updatedIntervention;
    });

    await this.syncClaimFromIntervention(stop.reclamoId, nextClaimStatus, payload);

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
      },
    });

    if (!intervention) {
      throw new HttpException('Intervencion no encontrada', HttpStatus.NOT_FOUND);
    }

    const evidence = await this.prisma.routingInterventionEvidence.create({
      data: {
        interventionId: payload.interventionId,
        tipo: payload.tipo,
        nombreArchivo: payload.nombreArchivo,
        urlArchivo: payload.urlArchivo,
        descripcion: payload.descripcion,
      },
    });

    await this.syncClaimEvidenceObservation(intervention.reclamoId, payload, evidence.createdAt);

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

  private async buildSimulation(payload: SimulateRoutingDto, forcePersist: boolean, generationRequestId: string | null) {
    const maxFetch = payload.maxFetch ?? 200;
    const planningDate = payload.planningDate ?? new Date().toISOString().slice(0, 10);
    const useGoogleOptimization = payload.useGoogleOptimization ?? true;
    const persistPlan = forcePersist || payload.persistPlan === true;

    const rules = payload.overrideRules ?? (await this.getRules()).data;
    if (!rules.crews.length || !rules.categoryRules.length) {
      throw new HttpException(
        'No hay reglas de ruteo configuradas (categoryRules/crews)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const fetchedClaims = await this.fetchClaims(maxFetch);

    // Exclude claims already assigned to a confirmed plan or actively reserved by another run
    const blockedClaimIds = forcePersist
      ? await this.getBlockedClaimIds()
      : new Set<string>();

    const validClaims = fetchedClaims.filter(
      (c) => Number.isFinite(c.lat) && Number.isFinite(c.lng) && !blockedClaimIds.has(c.id),
    );

    const zoneByClaimId = new Map<string, string | null>();
    for (const claim of validClaims) {
      const zoneId = this.findZoneForClaim(claim.lat, claim.lng, rules.zones ?? []);
      zoneByClaimId.set(claim.id, zoneId);
    }

    const categoryQuota = new Map<string, number>();
    for (const rule of rules.categoryRules) {
      categoryQuota.set(rule.categoria, rule.cupoDiario);
    }

    const categoryConsumption: Record<string, number> = {};
    const unassignedByReason: Record<string, number> = {};

    const prioritizedClaims = [...validClaims].sort((a, b) => {
      const pDiff = this.priorityWeight(b.prioridad) - this.priorityWeight(a.prioridad);
      if (pDiff !== 0) {
        return pDiff;
      }
      return a.id.localeCompare(b.id);
    });

    const routeBuilders = rules.crews.map((crew) => ({ crew, claims: [] as ReclamoItem[] }));
    const unassigned: Array<{ reclamoId: string; reason: string }> = [];

    for (const claim of prioritizedClaims) {
      const quota = categoryQuota.get(claim.categoria) ?? 0;
      const consumed = categoryConsumption[claim.categoria] ?? 0;

      if (consumed >= quota) {
        this.pushUnassigned(unassigned, unassignedByReason, claim.id, 'category_quota_reached');
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
        this.pushUnassigned(unassigned, unassignedByReason, claim.id, 'no_eligible_crew');
        continue;
      }

      candidates.sort((a, b) => a.claims.length - b.claims.length);
      candidates[0].claims.push(claim);
      categoryConsumption[claim.categoria] = consumed + 1;
    }

    let routes = routeBuilders
      .filter((r) => r.claims.length > 0)
      .map((builder) =>
        this.buildRoute(builder.crew, builder.claims, zoneByClaimId, payload.originLat, payload.originLng),
      );

    let optimizedRoutes = 0;
    let failedRoutes = 0;

    if (useGoogleOptimization) {
      const optimizedResult = await this.optimizeRoutesWithGoogle(routes, payload.originLat, payload.originLng);
      routes = optimizedResult.routes;
      optimizedRoutes = optimizedResult.optimizedRoutes;
      failedRoutes = optimizedResult.failedRoutes;
    }

    const totalAssigned = routes.reduce((acc, route) => acc + route.assignedClaims, 0);

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
      const assignedClaimIds = routes.flatMap((r) => r.stops.map((s) => s.reclamoId));
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

  private async fetchClaims(maxFetch: number): Promise<ReclamoItem[]> {
    const claims: ReclamoItem[] = [];
    const limitPerPage = 100;
    let page = 1;

    while (claims.length < maxFetch) {
      const limit = Math.min(limitPerPage, maxFetch - claims.length);
      const response = await firstValueFrom(
        this.natsClient
          .send<{ items: any[]; pagination: { hasNextPage: boolean } }>('reclamos.find-all', {
            page,
            limit,
            sortDirection: -1,
          })
          .pipe(timeout(12000)),
      );

      const items = response?.items ?? [];
      if (!items.length) {
        break;
      }

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
    originLat?: number,
    originLng?: number,
  ) {
    const sorted = [...claims].sort((a, b) => this.priorityWeight(b.prioridad) - this.priorityWeight(a.prioridad));

    let prevLat = crew.startLat ?? originLat ?? sorted[0].lat;
    let prevLng = crew.startLng ?? originLng ?? sorted[0].lng;
    let totalDistance = 0;
    let totalDuration = 0;

    const stops = sorted.map((claim, index) => {
      const distance = index === 0 ? 0 : this.haversineKm(prevLat, prevLng, claim.lat, claim.lng);
      const duration = index === 0 ? 0 : Math.max(1, Math.round((distance / 30) * 60));

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

  private async optimizeRoutesWithGoogle(
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
        categoria: ClaimCategoria;
        prioridad: ClaimPrioridad;
        zoneId: string | null;
        lat: number;
        lng: number;
        direccion: string;
        distanceFromPreviousKm: number;
        durationFromPreviousMin: number;
        createdAt: string;
      }>;
    }>,
    originLat?: number,
    originLng?: number,
  ) {
    if (!this.googleMapsApiKey.trim()) {
      this.logger.warn('useGoogleOptimization=true pero falta GOOGLE_MAPS_API_KEY; se usa fallback local');
      return { routes, optimizedRoutes: 0, failedRoutes: routes.length };
    }

    const optimizedRoutes: typeof routes = [];
    let success = 0;
    let failed = 0;

    for (const route of routes) {
      try {
        const optimized = await this.optimizeSingleRouteWithGoogle(route, originLat, originLng);
        optimizedRoutes.push(optimized);
        success += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `No se pudo optimizar ruta crewId=${route.crewId} con Google: ${error instanceof Error ? error.message : String(error)}`,
        );
        optimizedRoutes.push(route);
      }
    }

    return {
      routes: optimizedRoutes,
      optimizedRoutes: success,
      failedRoutes: failed,
    };
  }

  private async optimizeSingleRouteWithGoogle(
    route: {
      crewId: string;
      nombre: string;
      assignedClaims: number;
      maxReclamosDiarios: number;
      totalDistanceKm: number;
      totalDurationMin: number;
      stops: Array<{
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
      }>;
    },
    originLat?: number,
    originLng?: number,
  ) {
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
          summary: summary as unknown as object,
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

      // 2. Reserve each assigned claim atomically
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

      // 3. Verify no claim was already assigned to another confirmed plan
      const conflicts = await tx.routingClaimAllocation.findMany({
        where: {
          claimId: { in: assignedClaimIds },
          state: 'assigned',
          assignedPlanId: { not: plan.id },
        },
        select: { claimId: true },
      });

      if (conflicts.length > 0) {
        throw new HttpException(
          `${conflicts.length} reclamo(s) ya fueron asignados a otro plan confirmado. Regenera la corrida para obtener candidatos actualizados.`,
          HttpStatus.CONFLICT,
        );
      }

      // 4. Link request record to plan if provided
      if (generationRequestId) {
        await tx.routingGenerationRequest.update({
          where: { id: generationRequestId },
          data: { planId: plan.id },
        });
      }

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
        summary: summary as unknown as object,
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

  private resolveStopStatusByIntervention(result: InterventionResult): RoutingStopStatus {
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
  ): Promise<void> {
    const observationText = [
      `Intervencion de ruta: ${payload.result}`,
      payload.observation?.trim() ? `Detalle: ${payload.observation.trim()}` : null,
      payload.performedBy?.trim() ? `Ejecutado por: ${payload.performedBy.trim()}` : null,
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
          },
        })
        .pipe(timeout(12000)),
    );
  }

  private async syncClaimEvidenceObservation(
    reclamoId: string,
    payload: AttachInterventionEvidenceDto,
    createdAt: Date,
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
      if (lat >= zone.minLat && lat <= zone.maxLat && lng >= zone.minLng && lng <= zone.maxLng) {
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

  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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
