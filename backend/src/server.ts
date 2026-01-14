import 'dotenv/config';
import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

async function shutdown() {
  await app.close();
}

process.on('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.on('SIGTERM', () => shutdown().finally(() => process.exit(0)));
