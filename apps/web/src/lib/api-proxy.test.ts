import { describe, expect, it } from 'vitest';
import nextConfig, { API_PROXY_ORIGIN } from '../../next.config.mjs';

describe('Next API proxy', () => {
  it('forwards same-origin /v1 requests to the server-only API origin', async () => {
    const rewrites = await nextConfig.rewrites?.();
    expect(API_PROXY_ORIGIN).toBe('http://localhost:8080');
    expect(rewrites).toEqual([
      { source: '/v1/:path*', destination: 'http://localhost:8080/v1/:path*' },
    ]);
  });
});
