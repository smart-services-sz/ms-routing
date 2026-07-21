-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "RoutingCategoryRule" (
    "id" UUID NOT NULL,
    "categoria" TEXT NOT NULL,
    "cupoDiario" INTEGER NOT NULL,
    "pesoPrioridad" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingCategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingCrewRule" (
    "id" UUID NOT NULL,
    "crewId" TEXT NOT NULL,
    "nombre" TEXT,
    "maxReclamosDiarios" INTEGER NOT NULL,
    "allowedCategorias" TEXT[],
    "allowedZoneIds" TEXT[],
    "startLat" DOUBLE PRECISION,
    "startLng" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingCrewRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingZoneRule" (
    "id" TEXT NOT NULL,
    "nombre" TEXT,
    "minLat" DOUBLE PRECISION NOT NULL,
    "maxLat" DOUBLE PRECISION NOT NULL,
    "minLng" DOUBLE PRECISION NOT NULL,
    "maxLng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingZoneRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingAreaPlan" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "categorias" TEXT[],
    "originAddress" TEXT,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "dailyByUser" INTEGER NOT NULL,
    "dailyByCategory" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingAreaPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingPlan" (
    "id" UUID NOT NULL,
    "planningDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingClaimAllocation" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'available',
    "reservationToken" TEXT,
    "reservedByPlanId" UUID,
    "reservedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "assignedPlanId" UUID,
    "assignedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingClaimAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingGenerationRequest" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planningDate" TIMESTAMP(3),
    "planId" UUID,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingGenerationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRoute" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "crewId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'assigned',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedClaims" INTEGER NOT NULL,
    "maxReclamosDiarios" INTEGER NOT NULL,
    "totalDistanceKm" DOUBLE PRECISION NOT NULL,
    "totalDurationMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingStop" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "visitedAt" TIMESTAMP(3),
    "reclamoId" UUID NOT NULL,
    "categoria" TEXT NOT NULL,
    "prioridad" TEXT NOT NULL,
    "zoneId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "direccion" TEXT NOT NULL,
    "distanceFromPreviousKm" DOUBLE PRECISION NOT NULL,
    "durationFromPreviousMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingIntervention" (
    "id" UUID NOT NULL,
    "routeId" UUID NOT NULL,
    "stopId" UUID NOT NULL,
    "reclamoId" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "observation" TEXT,
    "performedBy" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingInterventionEvidence" (
    "id" UUID NOT NULL,
    "interventionId" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombreArchivo" TEXT NOT NULL,
    "urlArchivo" TEXT NOT NULL,
    "descripcion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingInterventionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingUnassigned" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "reclamoId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingUnassigned_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoutingCategoryRule_categoria_key" ON "RoutingCategoryRule"("categoria");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingCrewRule_crewId_key" ON "RoutingCrewRule"("crewId");

-- CreateIndex
CREATE INDEX "RoutingAreaPlan_updatedAt_idx" ON "RoutingAreaPlan"("updatedAt");

-- CreateIndex
CREATE INDEX "RoutingPlan_planningDate_idx" ON "RoutingPlan"("planningDate");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingClaimAllocation_claimId_key" ON "RoutingClaimAllocation"("claimId");

-- CreateIndex
CREATE INDEX "RoutingClaimAllocation_state_expiresAt_idx" ON "RoutingClaimAllocation"("state", "expiresAt");

-- CreateIndex
CREATE INDEX "RoutingClaimAllocation_reservedByPlanId_idx" ON "RoutingClaimAllocation"("reservedByPlanId");

-- CreateIndex
CREATE INDEX "RoutingClaimAllocation_assignedPlanId_idx" ON "RoutingClaimAllocation"("assignedPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingGenerationRequest_idempotencyKey_key" ON "RoutingGenerationRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RoutingGenerationRequest_status_updatedAt_idx" ON "RoutingGenerationRequest"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "RoutingRoute_planId_idx" ON "RoutingRoute"("planId");

-- CreateIndex
CREATE INDEX "RoutingStop_routeId_idx" ON "RoutingStop"("routeId");

-- CreateIndex
CREATE INDEX "RoutingStop_reclamoId_idx" ON "RoutingStop"("reclamoId");

-- CreateIndex
CREATE UNIQUE INDEX "RoutingIntervention_stopId_key" ON "RoutingIntervention"("stopId");

-- CreateIndex
CREATE INDEX "RoutingIntervention_routeId_idx" ON "RoutingIntervention"("routeId");

-- CreateIndex
CREATE INDEX "RoutingIntervention_reclamoId_idx" ON "RoutingIntervention"("reclamoId");

-- CreateIndex
CREATE INDEX "RoutingInterventionEvidence_interventionId_idx" ON "RoutingInterventionEvidence"("interventionId");

-- CreateIndex
CREATE INDEX "RoutingUnassigned_planId_idx" ON "RoutingUnassigned"("planId");

-- AddForeignKey
ALTER TABLE "RoutingRoute" ADD CONSTRAINT "RoutingRoute_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RoutingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingStop" ADD CONSTRAINT "RoutingStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "RoutingRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingIntervention" ADD CONSTRAINT "RoutingIntervention_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "RoutingRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingIntervention" ADD CONSTRAINT "RoutingIntervention_stopId_fkey" FOREIGN KEY ("stopId") REFERENCES "RoutingStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingInterventionEvidence" ADD CONSTRAINT "RoutingInterventionEvidence_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "RoutingIntervention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingUnassigned" ADD CONSTRAINT "RoutingUnassigned_planId_fkey" FOREIGN KEY ("planId") REFERENCES "RoutingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
