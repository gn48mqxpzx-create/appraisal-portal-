CREATE TABLE "current_compensation" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "currentCompensation" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "effectiveDate" DATE NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "current_compensation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "current_compensation_staffId_key" ON "current_compensation"("staffId");
CREATE INDEX "current_compensation_effectiveDate_idx" ON "current_compensation"("effectiveDate");
CREATE INDEX "current_compensation_uploadedAt_idx" ON "current_compensation"("uploadedAt");

ALTER TABLE "current_compensation"
ADD CONSTRAINT "current_compensation_staffId_fkey"
FOREIGN KEY ("staffId") REFERENCES "employee_directory"("staffId")
ON DELETE NO ACTION ON UPDATE CASCADE;
