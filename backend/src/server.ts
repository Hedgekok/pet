import 'dotenv/config';
import Fastify from 'fastify';
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
const otpStore = new Map<string, OtpRecord>();

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

app.register(cookie);
app.register(jwt, { secret: process.env.JWT_SECRET! });

async function requireAuth(req: any, reply: any) {
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

    return animal;
  });

  return { animal };
});

app.get('/me/match-candidates', { preHandler: requireAuth }, async () => {
  return { candidates: [] };
});

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

const port = Number(process.env.PORT ?? 3000);

app.post('/auth/start', async (req, reply) => {
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

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown() {
  await prisma.$disconnect();
}

process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));
