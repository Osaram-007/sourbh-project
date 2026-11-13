-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'BANNED');

-- CreateEnum
CREATE TYPE "ConnectorType" AS ENUM ('CCS2', 'CHADEMO', 'TYPE2', 'TYPE1', 'GB_T', 'BHARAT_AC', 'BHARAT_DC', 'WALL_SOCKET');

-- CreateEnum
CREATE TYPE "CurrentType" AS ENUM ('AC', 'DC');

-- CreateEnum
CREATE TYPE "StationStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ConnectorStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'FAULTED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpoCredential" (
    "id" TEXT NOT NULL,
    "cpoName" TEXT NOT NULL,
    "authToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "headers" JSONB NOT NULL,
    "cookies" JSONB,
    "expiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "CpoCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrawlerLog" (
    "id" TEXT NOT NULL,
    "cpoCredentialId" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlerLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Station" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "operator" TEXT,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "status" "StationStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "imageUrl" TEXT,
    "operatingHours" TEXT,
    "amenities" TEXT[],
    "pricingInfo" TEXT,

    CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Connector" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "externalId" TEXT,
    "type" "ConnectorType" NOT NULL,
    "powerKw" DOUBLE PRECISION,
    "currentType" "CurrentType" NOT NULL,
    "status" "ConnectorStatus" NOT NULL DEFAULT 'UNKNOWN',
    "pricing" DOUBLE PRECISION,

    CONSTRAINT "Connector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StationSnapshot" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "status" "StationStatus" NOT NULL,
    "syncSource" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConnectorSnapshot" (
    "id" TEXT NOT NULL,
    "stationSnapshotId" TEXT NOT NULL,
    "connectorType" "ConnectorType" NOT NULL,
    "powerKw" DOUBLE PRECISION,
    "currentType" "CurrentType" NOT NULL,
    "status" "ConnectorStatus" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConnectorSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "totalRaw" INTEGER NOT NULL DEFAULT 0,
    "totalDeduplicated" INTEGER NOT NULL DEFAULT 0,
    "snapshotsCaptured" INTEGER NOT NULL DEFAULT 0,
    "saveErrors" INTEGER NOT NULL DEFAULT 0,
    "scraperResults" JSONB NOT NULL,
    "error" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_stationId_key" ON "Favorite"("userId", "stationId");

-- CreateIndex
CREATE UNIQUE INDEX "CpoCredential_cpoName_key" ON "CpoCredential"("cpoName");

-- CreateIndex
CREATE INDEX "Station_latitude_longitude_idx" ON "Station"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "Station_source_externalId_key" ON "Station"("source", "externalId");

-- CreateIndex
CREATE INDEX "StationSnapshot_stationId_capturedAt_idx" ON "StationSnapshot"("stationId", "capturedAt");

-- CreateIndex
CREATE INDEX "StationSnapshot_capturedAt_idx" ON "StationSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "ConnectorSnapshot_stationSnapshotId_idx" ON "ConnectorSnapshot"("stationSnapshotId");

-- CreateIndex
CREATE INDEX "ConnectorSnapshot_capturedAt_idx" ON "ConnectorSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrawlerLog" ADD CONSTRAINT "CrawlerLog_cpoCredentialId_fkey" FOREIGN KEY ("cpoCredentialId") REFERENCES "CpoCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Connector" ADD CONSTRAINT "Connector_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationSnapshot" ADD CONSTRAINT "StationSnapshot_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConnectorSnapshot" ADD CONSTRAINT "ConnectorSnapshot_stationSnapshotId_fkey" FOREIGN KEY ("stationSnapshotId") REFERENCES "StationSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
