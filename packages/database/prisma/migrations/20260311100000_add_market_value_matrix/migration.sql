CREATE TYPE "TenureBandLabel" AS ENUM ('T1', 'T2', 'T3', 'T4');

CREATE TABLE "market_value_matrix" (
    "id"         TEXT                 NOT NULL,
    "roleName"   TEXT                 NOT NULL,
    "tenureBand" "TenureBandLabel"    NOT NULL,
    "minSalary"  DECIMAL(12,2)        NOT NULL,
    "maxSalary"  DECIMAL(12,2)        NOT NULL,
    "createdAt"  TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3)         NOT NULL,

    CONSTRAINT "market_value_matrix_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "market_value_matrix_roleName_tenureBand_key"
    ON "market_value_matrix"("roleName", "tenureBand");

CREATE INDEX "market_value_matrix_roleName_idx"
    ON "market_value_matrix"("roleName");

CREATE INDEX "market_value_matrix_tenureBand_idx"
    ON "market_value_matrix"("tenureBand");
