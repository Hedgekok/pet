-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('VISIT', 'VACCINATION', 'LAB_RESULT', 'PRESCRIPTION', 'PROCEDURE', 'NOTE');

-- CreateEnum
CREATE TYPE "DataSource" AS ENUM ('CLINIC', 'OWNER');

-- CreateTable
CREATE TABLE "Animal" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "species" TEXT,
    "breed" TEXT,
    "birthDate" TIMESTAMP(3),
    "microchipId" TEXT,
    "microchipStandard" TEXT,
    "microchipImplantedAt" TIMESTAMP(3),
    "microchipSource" "DataSource",

    CONSTRAINT "Animal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clinic" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "externalKey" TEXT,

    CONSTRAINT "Clinic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "animalId" TEXT NOT NULL,
    "clinicId" TEXT,
    "type" "EventType" NOT NULL,
    "source" "DataSource" NOT NULL DEFAULT 'CLINIC',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "MedicalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Clinic_externalKey_key" ON "Clinic"("externalKey");

-- CreateIndex
CREATE INDEX "MedicalEvent_animalId_occurredAt_idx" ON "MedicalEvent"("animalId", "occurredAt");

-- AddForeignKey
ALTER TABLE "MedicalEvent" ADD CONSTRAINT "MedicalEvent_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalEvent" ADD CONSTRAINT "MedicalEvent_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
