BEGIN;

ALTER TABLE "RoutingCategoryRule" ADD COLUMN "municipalityId" TEXT;
ALTER TABLE "RoutingCrewRule" ADD COLUMN "municipalityId" TEXT;
ALTER TABLE "RoutingZoneRule" ADD COLUMN "municipalityId" TEXT;
ALTER TABLE "RoutingAreaPlan" ADD COLUMN "municipalityId" TEXT;
ALTER TABLE "RoutingPlan" ADD COLUMN "municipalityId" TEXT;
ALTER TABLE "RoutingGenerationRequest" ADD COLUMN "municipalityId" TEXT;

ALTER TABLE "RoutingZoneRule" ADD COLUMN "key" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "RoutingZoneRule" ALTER COLUMN "key" DROP DEFAULT;
ALTER TABLE "RoutingZoneRule" DROP CONSTRAINT "RoutingZoneRule_pkey";
ALTER TABLE "RoutingZoneRule" ADD CONSTRAINT "RoutingZoneRule_pkey" PRIMARY KEY ("key");

DROP INDEX "RoutingCategoryRule_categoria_key";
DROP INDEX "RoutingCrewRule_crewId_key";
DROP INDEX "RoutingGenerationRequest_idempotencyKey_key";

CREATE UNIQUE INDEX "RoutingCategoryRule_municipalityId_categoria_key"
ON "RoutingCategoryRule"("municipalityId", "categoria");
CREATE UNIQUE INDEX "RoutingCrewRule_municipalityId_crewId_key"
ON "RoutingCrewRule"("municipalityId", "crewId");
CREATE UNIQUE INDEX "RoutingZoneRule_municipalityId_id_key"
ON "RoutingZoneRule"("municipalityId", "id");
CREATE UNIQUE INDEX "RoutingGenerationRequest_municipalityId_idempotencyKey_key"
ON "RoutingGenerationRequest"("municipalityId", "idempotencyKey");
CREATE INDEX "RoutingAreaPlan_municipalityId_updatedAt_idx"
ON "RoutingAreaPlan"("municipalityId", "updatedAt");
CREATE INDEX "RoutingPlan_municipalityId_planningDate_idx"
ON "RoutingPlan"("municipalityId", "planningDate");

COMMIT;