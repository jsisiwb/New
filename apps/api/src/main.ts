/**
 * API entry point. Configuration comes from the environment by NAME only; no secret is ever defaulted to a
 * usable value, so a missing variable fails loudly instead of starting an insecure server.
 */
import { configFromEnv, createPool } from '@yeonjae/db';
import { buildApi } from './server.js';
import { corsPolicyFromEnv } from './cors.js';

const pool = createPool(configFromEnv());
const app = buildApi({
  pool,
  // Secure cookies unless explicitly disabled for local HTTP development.
  secureCookies: process.env.YEONJAE_INSECURE_COOKIES !== 'true',
  // Cross-origin browser access is DENIED unless origins are listed. An invalid entry throws here, at
  // startup, naming the value — a silently dropped typo would produce a deployment that looks configured
  // and refuses every browser request.
  corsOrigins: corsPolicyFromEnv().origins,
  // Proxies whose X-Forwarded-For may be believed for rate-limit identity. Empty means the socket address
  // is used, which is safe but coarse behind a load balancer.
  trustedProxies: (process.env.YEONJAE_TRUSTED_PROXIES ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
  logger: true,
});

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '127.0.0.1';
await app.listen({ port, host });
