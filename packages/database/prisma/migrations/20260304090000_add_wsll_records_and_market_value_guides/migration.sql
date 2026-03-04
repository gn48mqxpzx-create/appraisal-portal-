-- CreateEnum
CREATE TYPE "WsllRecordSource" AS ENUM ('CSV', 'UI', 'API');

-- CreateEnum
CREATE TYPE "MarketValueSource" AS ENUM ('CSV', 'UI', 'API');

-- CreateTable
CREATE TABLE "wsll_records" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "wsllScore" DOUBLE PRECISION NOT NULL,
    "wsllDate" DATE,
    "source" "WsllRecordSource" NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawRowJson" JSONB,
    "flags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wsll_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_value_guides" (
    "id" TEXT NOT NULL,
    "staffRole" TEXT NOT NULL,
    "location" TEXT,
    "band" TEXT,
    "minValue" DOUBLE PRECISION NOT NULL,
    "maxValue" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "effectiveDate" DATE NOT NULL,
    "source" "MarketValueSource" NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawRowJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_value_guides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wsll_records_staffId_idx" ON "wsll_records"("staffId");

-- CreateIndex
CREATE INDEX "wsll_records_wsllDate_uploadedAt_idx" ON "wsll_records"("wsllDate", "uploadedAt");

-- CreateIndex
CREATE INDEX "market_value_guides_staffRole_location_effectiveDate_idx" ON "market_value_guides"("staffRole", "location", "effectiveDate");

-- CreateIndex
CREATE INDEX "market_value_guides_effectiveDate_idx" ON "market_value_guides"("effectiveDate");
