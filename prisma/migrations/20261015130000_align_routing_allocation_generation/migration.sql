BEGIN;

SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout = '10s';

ALTER TABLE "RoutingClaimAllocation"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "reservedAt" TYPE TIMESTAMP(3) USING "reservedAt"::timestamp(3),
  ALTER COLUMN "expiresAt" TYPE TIMESTAMP(3) USING "expiresAt"::timestamp(3),
  ALTER COLUMN "assignedAt" TYPE TIMESTAMP(3) USING "assignedAt"::timestamp(3),
  ALTER COLUMN "releasedAt" TYPE TIMESTAMP(3) USING "releasedAt"::timestamp(3),
  ALTER COLUMN "createdAt" TYPE TIMESTAMP(3) USING "createdAt"::timestamp(3),
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMP(3) USING "updatedAt"::timestamp(3);

ALTER TABLE "RoutingGenerationRequest"
  ALTER COLUMN "id" DROP DEFAULT,
  ALTER COLUMN "planningDate" TYPE TIMESTAMP(3) USING "planningDate"::timestamp(3),
  ALTER COLUMN "createdAt" TYPE TIMESTAMP(3) USING "createdAt"::timestamp(3),
  ALTER COLUMN "updatedAt" DROP DEFAULT,
  ALTER COLUMN "updatedAt" TYPE TIMESTAMP(3) USING "updatedAt"::timestamp(3);

COMMIT;