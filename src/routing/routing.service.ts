import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { PrismaService } from '../prisma/prisma.service';
import { SimulateRoutingDto } from './dto/simulate-routing.dto';
import { UpsertRoutingRulesDto } from './dto/upsert-routing-rules.dto';
import { ClaimPrioridad, ReclamoItem, SimulationSummary } from './routing.types';
import { firstValueFrom, timeout } from 'rxjs';

@Injectable()
export class RoutingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('NATS_CLIENT') private readonly natsClient: ClientProxy,
  ) {}

  async upsertRules(payload: UpsertRoutingRulesDto) {
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

      if (payload.crews.length > 0) {
        await tx.routingCrewRule.createMany({
          data: payload.crews.map((crew) => ({
            crewId: crew.crewId,
            nombre: crew.nombre ?? crew.crewId,
            maxReclamosDiarios: crew.maxReclamosDiarios,
            allowedCategorias: crew.allowedCategorias,
            allowedZoneIds: crew.allowedZoneIds ?? [],
            startLat: crew.startLat,
            startLng: crew.startLng,
          })),
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
          nombre: c.nombre ?? c.crewId,
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

  async simulate(payload: SimulateRoutingDto) {
    return this.buildSimulation(payload, false);
  }

  async generate(payload: SimulateRoutingDto) {
    return this.buildSimulation(payload, true);
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

  async confirmPlan(id: string) {
    const exists = await this.prisma.routingPlan.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      throw new HttpException('Plan de ruteo no encontrado', HttpStatus.NOT_FOUND);
    }

    await this.prisma.routingPlan.update({
      where: { id },
      data: { status: 'confirmed' },
    });

    return { status: 'ok', message: 'Plan confirmado correctamente' };
  }

  private async buildSimulation(payload: SimulateRoutingDto, forcePersist: boolean) {
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
    const validClaims = fetchedClaims.filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng));

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

    const routes = routeBuilders
      .filter((r) => r.claims.length > 0)
      .map((builder) =>
        this.buildRoute(builder.crew, builder.claims, zoneByClaimId, payload.originLat, payload.originLng),
      );

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
        optimizedRoutes: 0,
        failedRoutes: 0,
      },
    };

    let savedPlanId: string | null = null;
    if (persistPlan) {
      const plan = await this.persistPlan(planningDate, summary, routes, unassigned);
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
            assignedClaims: route.assignedClaims,
            maxReclamosDiarios: route.maxReclamosDiarios,
            totalDistanceKm: route.totalDistanceKm,
            totalDurationMin: route.totalDurationMin,
            stops: {
              create: route.stops.map((stop) => ({
                sequence: stop.sequence,
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
