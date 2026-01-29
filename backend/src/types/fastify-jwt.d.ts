import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; phoneE164: string };
    user: { sub: string; phoneE164: string };
  }
}
