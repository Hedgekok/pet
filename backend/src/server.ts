import 'dotenv/config';
import Fastify from 'fastify';
import { prisma } from './db.js';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ ok: true }));

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

app.post('/ingest/animal', async (req) => {
  const body = req.body as {
    name?: string;
    species?: string;
    breed?: string;
    birthDate?: string; // ISO
    microchipId?: string;
    microchipStandard?: string;
    microchipImplantedAt?: string; // ISO
    microchipSource?: 'CLINIC' | 'OWNER';
  };

  const animal = await prisma.animal.create({
    data: {
      name: body.name,
      species: body.species,
      breed: body.breed,
      birthDate: body.birthDate ? new Date(body.birthDate) : undefined,
      microchipId: body.microchipId,
      microchipStandard: body.microchipStandard,
      microchipImplantedAt: body.microchipImplantedAt ? new Date(body.microchipImplantedAt) : undefined,
      microchipSource: body.microchipSource,
    },
  });

  return { animal };
});

app.post('/ingest/event', async (req, reply) => {
  const body = req.body as {
    animalId: string;
    clinic?: { name: string; externalKey?: string };
    type: 'VISIT' | 'VACCINATION' | 'LAB_RESULT' | 'PRESCRIPTION' | 'PROCEDURE' | 'NOTE';
    occurredAt: string; // ISO
    source?: 'CLINIC' | 'OWNER';
    data: unknown; // JSON
  };

  const animal = await prisma.animal.findUnique({ where: { id: body.animalId } });
  if (!animal) return reply.code(404).send({ error: 'Animal not found' });

  let clinicId: string | undefined = undefined;

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
      data: body.data as any,
    },
  });

  return { event };
});

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown() {
  await prisma.$disconnect();
}

process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));
