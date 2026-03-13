-- CreateTable
CREATE TABLE "increase_guardrails" (
    "id" TEXT NOT NULL,
    "levelName" TEXT NOT NULL,
    "colorCode" TEXT NOT NULL,
    "minPercent" DECIMAL(8,4),
    "maxPercent" DECIMAL(8,4),
    "minAmount" DECIMAL(12,2),
    "maxAmount" DECIMAL(12,2),
    "actionRequired" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "increase_guardrails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "increase_guardrails_isActive_sortOrder_idx" ON "increase_guardrails"("isActive", "sortOrder");
