-- Role Library engine: Standardized roles as master taxonomy

CREATE TABLE "standardized_roles" (
    "id" TEXT NOT NULL,
    "roleName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standardized_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "standardized_roles_roleName_key"
    ON "standardized_roles"("roleName");

CREATE INDEX "standardized_roles_isActive_idx"
    ON "standardized_roles"("isActive");

ALTER TYPE "RoleMatchSource" RENAME TO "RoleMatchSource_old";
CREATE TYPE "RoleMatchSource" AS ENUM ('SAVED_RULE', 'AUTO_SIMILARITY', 'NEW_ROLE_SUGGESTION', 'ADMIN_CONFIRMED');

ALTER TABLE "role_alignment_mappings"
        ALTER COLUMN "matchSource" DROP DEFAULT,
    ALTER COLUMN "matchSource" TYPE "RoleMatchSource"
    USING (
      CASE
        WHEN "matchSource"::text = 'AUTO' THEN 'AUTO_SIMILARITY'::"RoleMatchSource"
        ELSE 'ADMIN_CONFIRMED'::"RoleMatchSource"
      END
    );

ALTER TABLE "role_alignment_mappings"
        ALTER COLUMN "matchSource" SET DEFAULT 'ADMIN_CONFIRMED';

DROP TYPE "RoleMatchSource_old";

ALTER TABLE "role_alignment_mappings"
    ADD COLUMN "standardizedRoleId" TEXT,
    ADD COLUMN "confidenceScore" DECIMAL(5,4);

ALTER TABLE "role_alignment_mappings"
    ADD CONSTRAINT "role_alignment_mappings_standardizedRoleId_fkey"
    FOREIGN KEY ("standardizedRoleId") REFERENCES "standardized_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "role_alignment_mappings_standardizedRoleId_idx"
    ON "role_alignment_mappings"("standardizedRoleId");

ALTER TABLE "market_value_matrix"
    ADD COLUMN "standardizedRoleId" TEXT;

ALTER TABLE "market_value_matrix"
    ADD CONSTRAINT "market_value_matrix_standardizedRoleId_fkey"
    FOREIGN KEY ("standardizedRoleId") REFERENCES "standardized_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "market_value_matrix_standardizedRoleId_idx"
    ON "market_value_matrix"("standardizedRoleId");
