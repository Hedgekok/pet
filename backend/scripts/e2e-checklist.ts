import http from 'node:http';
import { buildApp } from '../src/app.js';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

type ChecklistItem = { name: string; ok: boolean; error?: string };

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

function isString(value: JsonValue | undefined): value is string {
  return typeof value === 'string';
}

function getField(obj: JsonObject, key: string): JsonValue | undefined {
  return obj[key];
}

async function requestJson(
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: JsonValue }
): Promise<{ status: number; json: JsonValue | null; raw: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const payload = options.body ? JSON.stringify(options.body) : '';
    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
    };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(Buffer.byteLength(payload));
    }

    const req = http.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method,
        headers,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json: JsonValue | null = null;
          if (data.length > 0) {
            const parsed: JsonValue = JSON.parse(data);
            json = parsed;
          }
          resolve({ status: res.statusCode ?? 0, json, raw: data });
        });
      }
    );

    req.on('error', reject);

    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const app = buildApp();
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const baseUrl = new URL(address).toString().replace(/\/$/, '');

  const results: ChecklistItem[] = [];
  let failed = false;

  const state: {
    token: string;
    animalAId: string;
    orphanAnimalId: string;
    eventId: string;
  } = {
    token: '',
    animalAId: '',
    orphanAnimalId: '',
    eventId: '',
  };

  const runStep = async (name: string, fn: () => Promise<void>) => {
    if (failed) {
      results.push({ name, ok: false, error: 'Skipped due to previous failure.' });
      return;
    }
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name, ok: false, error: message });
      failed = true;
    }
  };

  try {
    await runStep('Health', async () => {
      const res = await requestJson(`${baseUrl}/health`, { method: 'GET' });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });

    await runStep('Auth start', async () => {
      const res = await requestJson(`${baseUrl}/auth/start`, {
        method: 'POST',
        body: { phone: '89990001122' },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });

    await runStep('Dev token', async () => {
      const res = await requestJson(`${baseUrl}/auth/dev-token`, {
        method: 'POST',
        body: { phone: '+79990001122' },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!isObject(res.json ?? undefined)) throw new Error('Expected JSON object.');
      const tokenValue = getField(res.json, 'token');
      if (!isString(tokenValue)) throw new Error('Missing token string.');
      state.token = tokenValue;
    });

    await runStep('Protected /me/animals', async () => {
      const res = await requestJson(`${baseUrl}/me/animals`, {
        method: 'GET',
        headers: { authorization: `Bearer ${state.token}` },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!isObject(res.json ?? undefined)) throw new Error('Expected JSON object.');
      const animalsValue = getField(res.json, 'animals');
      if (!isArray(animalsValue)) throw new Error('Expected animals array.');
    });

    await runStep('Ingest animal A', async () => {
      const res = await requestJson(`${baseUrl}/ingest/animal`, {
        method: 'POST',
        body: {
          ownerPhone: '89990001122',
          name: 'Barsik',
          species: 'cat',
          breed: 'mixed',
          birthDate: '2022-05-01T00:00:00.000Z',
          clinic: { name: 'HappyVet', externalKey: 'happyvet-001' },
          externalAnimalId: 'HV-1001',
        },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!isObject(res.json ?? undefined)) throw new Error('Expected JSON object.');
      const animalValue = getField(res.json, 'animal');
      if (!isObject(animalValue)) throw new Error('Expected animal object.');
      const idValue = getField(animalValue, 'id');
      if (!isString(idValue)) throw new Error('Missing animal id.');
      state.animalAId = idValue;
    });

    await runStep('Ingest animal B', async () => {
      const res = await requestJson(`${baseUrl}/ingest/animal`, {
        method: 'POST',
        body: {
          ownerPhone: '89990001122',
          name: 'Barsik',
          species: 'cat',
          breed: 'mixed',
          birthDate: '2022-05-01T00:00:00.000Z',
          clinic: { name: 'HappyVet', externalKey: 'happyvet-001' },
          externalAnimalId: 'HV-1002',
        },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });

    await runStep('Match candidates', async () => {
      const res = await requestJson(`${baseUrl}/me/match-candidates`, {
        method: 'GET',
        headers: { authorization: `Bearer ${state.token}` },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!isObject(res.json ?? undefined)) throw new Error('Expected JSON object.');
      const candidatesValue = getField(res.json, 'candidates');
      if (!isArray(candidatesValue)) throw new Error('Expected candidates array.');

      const hasPending = candidatesValue.some((item) => {
        if (!isObject(item)) return false;
        const statusValue = getField(item, 'status');
        return isString(statusValue) && statusValue === 'PENDING';
      });

      if (!hasPending) throw new Error('No PENDING match candidates found.');
    });

    await runStep('Ingest orphan animal', async () => {
      const res = await requestJson(`${baseUrl}/ingest/animal`, {
        method: 'POST',
        body: {
          name: 'Rex',
          species: 'dog',
          breed: 'mixed',
          birthDate: '2021-01-01T00:00:00.000Z',
          microchipId: 'RU-999-888-777',
          microchipStandard: 'ISO11784/11785',
          microchipSource: 'CLINIC',
        },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!isObject(res.json ?? undefined)) throw new Error('Expected JSON object.');
      const animalValue = getField(res.json, 'animal');
      if (!isObject(animalValue)) throw new Error('Expected animal object.');
      const idValue = getField(animalValue, 'id');
      if (!isString(idValue)) throw new Error('Missing orphan animal id.');
      state.orphanAnimalId = idValue;
    });

    await runStep('Ingest event', async () => {
      const res = await requestJson(`${baseUrl}/ingest/event`, {
        method: 'POST',
        body: {
          animalId: state.animalAId,
          clinic: { name: 'HappyVet', externalKey: 'happyvet-001' },
          type: 'VACCINATION',
          occurredAt: '2026-01-10T10:30:00.000Z',
          source: 'CLINIC',
          data: {
            vaccine: 'Rabies',
            batch: 'RB-2026-01',
            nextDueAt: '2027-01-10T00:00:00.000Z',
            notes: 'No adverse reactions',
          },
        },
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!isObject(res.json ?? undefined)) throw new Error('Expected JSON object.');
      const eventValue = getField(res.json, 'event');
      if (!isObject(eventValue)) throw new Error('Expected event object.');
      const idValue = getField(eventValue, 'id');
      if (!isString(idValue)) throw new Error('Missing event id.');
      state.eventId = idValue;
    });

    await runStep('Timeline', async () => {
      const res = await requestJson(`${baseUrl}/animals/${state.animalAId}/timeline`, {
        method: 'GET',
      });
      if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
      if (!isObject(res.json ?? undefined)) throw new Error('Expected JSON object.');
      const eventsValue = getField(res.json, 'events');
      if (!isArray(eventsValue)) throw new Error('Expected events array.');

      const eventIds = eventsValue
        .map((item) => {
          if (!isObject(item)) return '';
          const idValue = getField(item, 'id');
          return isString(idValue) ? idValue : '';
        })
        .filter((id) => id.length > 0);

      if (!eventIds.includes(state.eventId)) {
        throw new Error('Timeline does not include created event.');
      }

      for (let i = 0; i < eventsValue.length - 1; i += 1) {
        const current = eventsValue[i];
        const next = eventsValue[i + 1];
        if (!isObject(current) || !isObject(next)) continue;
        const currentAt = getField(current, 'occurredAt');
        const nextAt = getField(next, 'occurredAt');
        if (!isString(currentAt) || !isString(nextAt)) continue;
        if (new Date(currentAt).getTime() < new Date(nextAt).getTime()) {
          throw new Error('Timeline events are not sorted by occurredAt desc.');
        }
      }
    });
  } finally {
    await app.close();
  }

  for (const item of results) {
    if (item.ok) {
      console.log(`[✅] ${item.name}`);
    } else {
      console.log(`[❌] ${item.name}${item.error ? ` - ${item.error}` : ''}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[❌] E2E failed: ${message}`);
  process.exitCode = 1;
});
