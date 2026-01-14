-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "AnimalExternalRef" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "animalId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "externalAnimalId" TEXT NOT NULL,

    CONSTRAINT "AnimalExternalRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchCandidate" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidateAnimalId" TEXT NOT NULL,
    "newAnimalId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "reason" JSONB NOT NULL,
    "incoming" JSONB NOT NULL,

    CONSTRAINT "MatchCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnimalExternalRef_clinicId_externalAnimalId_key" ON "AnimalExternalRef"("clinicId", "externalAnimalId");

-- AddForeignKey
ALTER TABLE "AnimalExternalRef" ADD CONSTRAINT "AnimalExternalRef_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalExternalRef" ADD CONSTRAINT "AnimalExternalRef_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_candidateAnimalId_fkey" FOREIGN KEY ("candidateAnimalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchCandidate" ADD CONSTRAINT "MatchCandidate_newAnimalId_fkey" FOREIGN KEY ("newAnimalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
