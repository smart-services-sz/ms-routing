-- CreateTable
CREATE TABLE "RoutingActionHistory" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "planId" UUID,
    "routeId" UUID,
    "stopId" UUID,
    "interventionId" UUID,
    "evidenceId" UUID,
    "reclamoId" UUID,
    "actorId" TEXT,
    "previousStatus" TEXT,
    "newStatus" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutingActionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutingActionHistory_planId_createdAt_idx" ON "RoutingActionHistory"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingActionHistory_routeId_createdAt_idx" ON "RoutingActionHistory"("routeId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingActionHistory_stopId_createdAt_idx" ON "RoutingActionHistory"("stopId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingActionHistory_reclamoId_createdAt_idx" ON "RoutingActionHistory"("reclamoId", "createdAt");

-- CreateIndex
CREATE INDEX "RoutingActionHistory_action_createdAt_idx" ON "RoutingActionHistory"("action", "createdAt");