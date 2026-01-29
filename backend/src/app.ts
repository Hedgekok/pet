import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { Prisma, PrismaClient } from '@prisma/client';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');

  if (digits.startsWith('8')) return '+7' + digits.slice(1);
  if (digits.startsWith('7')) return '+' + digits;
  if (digits.startsWith('9')) return '+7' + digits;

  throw new Error('Invalid phone number');
}

function normalizeText(value?: string | null): string | undefined {
  if (!value) return undefined;
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

type OtpRecord = { code: string; expiresAt: number };

type MatchReasonDetail = { match: boolean; weight: number };
type MatchReason = {
  ownerMatch: MatchReasonDetail;
  species: MatchReasonDetail;
  name: MatchReasonDetail;
  birthDate: MatchReasonDetail;
  breed: MatchReasonDetail;
};
type IncomingCandidate = {
  ownerPhone: string | null;
  name: string | null;
  species: string | null;
  breed: string | null;
  birthDate: string | null;
  microchipId: string | null;
  microchipStandard: string | null;
  microchipImplantedAt: string | null;
  microchipSource: 'CLINIC' | 'OWNER' | null;
};

export function buildApp() {
  const otpStore = new Map<string, OtpRecord>();
  const prisma = new PrismaClient();
  const app = Fastify({ logger: true });

  app.register(cookie);
  app.register(jwt, { secret: process.env.JWT_SECRET! });

  app.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  }

  app.get('/me/animals', { preHandler: requireAuth }, async (req: any) => {
    const userId = req.user.sub as string;

    const animals = await prisma.animal.findMany({
      where: { ownerUserId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return { animals };
  });

  app.get('/health', async () => ({ ok: true }));

  app.post('/ingest/animal', async (req) => {
    const body = req.body as {
      ownerPhone?: string;
      name?: string;
      species?: string;
      breed?: string;
      birthDate?: string;
      microchipId?: string;
      microchipStandard?: string;
      microchipImplantedAt?: string;
      microchipSource?: 'CLINIC' | 'OWNER';
      clinic?: { name: string; externalKey?: string };
      externalAnimalId?: string;
    };
    const phoneE164 = body.ownerPhone ? normalizePhone(body.ownerPhone) : null;

    const animal = await prisma.$transaction(async (tx) => {
      let ownerUserId: string | null = null;

      if (phoneE164) {
        const user = await tx.user.upsert({
          where: { phoneE164 },
          update: {},
          create: { phoneE164 },
        });
        ownerUserId = user.id;
      }

      let clinicId: string | null = null;

      if (body.clinic?.externalKey) {
        const clinic = await tx.clinic.upsert({
          where: { externalKey: body.clinic.externalKey },
          update: { name: body.clinic.name },
          create: { name: body.clinic.name, externalKey: body.clinic.externalKey },
        });
        clinicId = clinic.id;
      } else if (body.clinic?.name) {
        const clinic = await tx.clinic.create({ data: { name: body.clinic.name } });
        clinicId = clinic.id;
      }

      const animal = await tx.animal.create({
        data: {
          ownerUserId,
          name: body.name ?? null,
          species: body.species ?? null,
          breed: body.breed ?? null,
          birthDate: body.birthDate ? new Date(body.birthDate) : null,
          microchipId: body.microchipId ?? null,
          microchipStandard: body.microchipStandard ?? null,
          microchipImplantedAt: body.microchipImplantedAt ? new Date(body.microchipImplantedAt) : null,
          microchipSource: body.microchipSource ?? null,
        },
      });

      if (clinicId && body.externalAnimalId) {
        await tx.animalExternalRef.upsert({
          where: {
            clinicId_externalAnimalId: {
              clinicId,
              externalAnimalId: body.externalAnimalId,
            },
          },
          update: { animalId: animal.id },
          create: {
            animalId: animal.id,
            clinicId,
            externalAnimalId: body.externalAnimalId,
          },
        });
      }

      if (ownerUserId) {
        const normalizedSpecies = normalizeText(body.species);
        const normalizedName = normalizeText(body.name);
        const normalizedBreed = normalizeText(body.breed);
        const normalizedBirthDate = body.birthDate ? new Date(body.birthDate) : undefined;
        const speciesFilter = body.species;

        const candidates = await tx.animal.findMany({
          where: {
            ownerUserId,
            ...(speciesFilter ? { species: speciesFilter } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        });

        const scoredCandidates = candidates
          .filter((candidate) => candidate.id !== animal.id)
          .map((candidate) => {
            const candidateSpecies = normalizeText(candidate.species);
            const candidateName = normalizeText(candidate.name);
            const candidateBreed = normalizeText(candidate.breed);
            const candidateBirthDate = candidate.birthDate ?? undefined;

            const reason: MatchReason = {
              ownerMatch: { match: true, weight: 0.35 },
              species: {
                match: normalizedSpecies !== undefined && normalizedSpecies === candidateSpecies,
                weight: 0.2,
              },
              name: {
                match: normalizedName !== undefined && normalizedName === candidateName,
                weight: 0.2,
              },
              birthDate: {
                match:
                  normalizedBirthDate !== undefined &&
                  candidateBirthDate !== undefined &&
                  normalizedBirthDate.getTime() === candidateBirthDate.getTime(),
                weight: 0.25,
              },
              breed: {
                match: normalizedBreed !== undefined && normalizedBreed === candidateBreed,
                weight: 0.1,
              },
            };

            const score =
              reason.ownerMatch.weight +
              (reason.species.match ? reason.species.weight : 0) +
              (reason.name.match ? reason.name.weight : 0) +
              (reason.birthDate.match ? reason.birthDate.weight : 0) +
              (reason.breed.match ? reason.breed.weight : 0);

            return { candidate, score, reason };
          })
          .filter((entry) => entry.score >= 0.65)
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);

        if (scoredCandidates.length > 0) {
          const incoming: IncomingCandidate = {
            ownerPhone: phoneE164,
            name: normalizedName ?? null,
            species: normalizedSpecies ?? null,
            breed: normalizedBreed ?? null,
            birthDate: normalizedBirthDate ? normalizedBirthDate.toISOString() : null,
            microchipId: body.microchipId ?? null,
            microchipStandard: body.microchipStandard ?? null,
            microchipImplantedAt: body.microchipImplantedAt ?? null,
            microchipSource: body.microchipSource ?? null,
          };

          await Promise.all(
            scoredCandidates.map((entry) =>
              tx.matchCandidate.create({
                data: {
                  candidateAnimalId: entry.candidate.id,
                  newAnimalId: animal.id,
                  score: entry.score,
                  status: 'PENDING',
                  reason: entry.reason,
                  incoming,
                },
              })
            )
          );
        }
      }

      return animal;
    });

    return { animal };
  });

  app.get('/me/match-candidates', { preHandler: requireAuth }, async (req: FastifyRequest) => {
    const userId = req.user.sub as string;

    const candidates = await prisma.matchCandidate.findMany({
      where: {
        status: 'PENDING',
        OR: [
          { candidateAnimal: { ownerUserId: userId } },
          { newAnimal: { ownerUserId: userId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        candidateAnimal: {
          select: { id: true, name: true, species: true, breed: true, birthDate: true },
        },
        newAnimal: {
          select: { id: true, name: true, species: true, breed: true, birthDate: true },
        },
      },
    });

    return { candidates };
  });

  async function resolveCandidate(
    userId: string,
    candidateId: string,
    action: 'CONFIRM' | 'REJECT'
  ) {
    return prisma.$transaction(async (tx) => {
      const candidate = await tx.matchCandidate.findUnique({
        where: { id: candidateId },
        select: { id: true, status: true, candidateAnimalId: true, newAnimalId: true },
      });

      if (!candidate) {
        return { error: 'NOT_FOUND' as const };
      }

      if (candidate.status !== 'PENDING') {
        return { error: 'NOT_PENDING' as const };
      }

      const owned = await tx.animal.count({
        where: {
          id: { in: [candidate.candidateAnimalId, candidate.newAnimalId] },
          ownerUserId: userId,
        },
      });

      if (owned === 0) {
        return { error: 'FORBIDDEN' as const };
      }

      const updated = await tx.matchCandidate.update({
        where: { id: candidateId },
        data: { status: action === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED' },
      });

      return { updated };
    });
  }

  app.post(
    '/me/match-candidates/:id/confirm',
    { preHandler: requireAuth },
    async (req: any, reply: any) => {
      const userId = req.user.sub as string;
      const { id } = req.params as { id: string };

      const res = await resolveCandidate(userId, id, 'CONFIRM');

      if ('error' in res) {
        if (res.error === 'NOT_FOUND') return reply.code(404).send({ error: 'MatchCandidate not found' });
        if (res.error === 'NOT_PENDING') return reply.code(409).send({ error: 'MatchCandidate is not PENDING' });
        if (res.error === 'FORBIDDEN') return reply.code(403).send({ error: 'Forbidden' });
      }

      return { candidate: res.updated };
    }
  );

  app.post(
    '/me/match-candidates/:id/reject',
    { preHandler: requireAuth },
    async (req: any, reply: any) => {
      const userId = req.user.sub as string;
      const { id } = req.params as { id: string };

      const res = await resolveCandidate(userId, id, 'REJECT');

      if ('error' in res) {
        if (res.error === 'NOT_FOUND') return reply.code(404).send({ error: 'MatchCandidate not found' });
        if (res.error === 'NOT_PENDING') return reply.code(409).send({ error: 'MatchCandidate is not PENDING' });
        if (res.error === 'FORBIDDEN') return reply.code(403).send({ error: 'Forbidden' });
      }

      return { candidate: res.updated };
    }
  );

  app.post('/ingest/event', async (req, reply) => {
    const body = req.body as {
      animalId: string;
      clinic?: { name: string; externalKey?: string };
      type: 'VISIT' | 'VACCINATION' | 'LAB_RESULT' | 'PRESCRIPTION' | 'PROCEDURE' | 'NOTE';
      occurredAt: string;
      source?: 'CLINIC' | 'OWNER';
      data: Prisma.InputJsonValue;
    };

    const animal = await prisma.animal.findUnique({ where: { id: body.animalId } });
    if (!animal) return reply.code(404).send({ error: 'Animal not found' });

    let clinicId: string | null = null;

    if (body.clinic?.externalKey) {
      const clinic = await prisma.clinic.upsert({
        where: { externalKey: body.clinic.externalKey },
        update: { name: body.clinic.name },
        create: { name: body.clinic.name, externalKey: body.clinic.externalKey },
      });
      clinicId = clinic.id;
    } else if (body.clinic?.name) {
      const clinic = await prisma.clinic.create({ data: { name: body.clinic.name } });
      clinicId = clinic.id;
    }

    const event = await prisma.medicalEvent.create({
      data: {
        animalId: body.animalId,
        clinicId,
        type: body.type,
        source: body.source ?? 'CLINIC',
        occurredAt: new Date(body.occurredAt),
        data: body.data,
      },
    });

    return { event };
  });

  app.get('/animals/:id/timeline', async (req, reply) => {
    const { id } = req.params as { id: string };

    const animal = await prisma.animal.findUnique({ where: { id } });
    if (!animal) return reply.code(404).send({ error: 'Animal not found' });

    const events = await prisma.medicalEvent.findMany({
      where: { animalId: id },
      orderBy: { occurredAt: 'desc' },
    });

    return { animal, events };
  });

  app.post('/auth/start', async (req) => {
    const body = req.body as { phone: string };

    const phoneE164 = normalizePhone(body.phone);

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 5 * 60 * 1000;

    otpStore.set(phoneE164, { code, expiresAt });

    req.log.info({ phoneE164, code }, 'DEV OTP issued');

    return { ok: true };
  });

  app.post('/auth/verify', async (req, reply) => {
    const body = req.body as { phone: string; code: string };

    const phoneE164 = normalizePhone(body.phone);

    const rec = otpStore.get(phoneE164);
    if (!rec) return reply.code(400).send({ error: 'No OTP requested' });
    if (Date.now() > rec.expiresAt) return reply.code(400).send({ error: 'OTP expired' });
    if (body.code !== rec.code) return reply.code(400).send({ error: 'Invalid code' });

    otpStore.delete(phoneE164);

    const user = await prisma.user.upsert({
      where: { phoneE164 },
      update: {},
      create: { phoneE164 },
    });

    const token = await reply.jwtSign({ sub: user.id, phoneE164 });

    return reply.send({ token, user: { id: user.id, phoneE164 } });
  });

  app.post('/auth/dev-token', async (req, reply) => {
    const body = req.body as { phone: string };

    let phoneE164: string;
    try {
      phoneE164 = normalizePhone(body.phone);
    } catch {
      return reply.code(400).send({ error: 'Invalid phone number' });
    }

    const user = await prisma.user.upsert({
      where: { phoneE164 },
      update: {},
      create: { phoneE164 },
    });

    const token = await reply.jwtSign({ sub: user.id, phoneE164 });

    return reply.send({ token, user: { id: user.id, phoneE164 } });
  });

  return app;
}
