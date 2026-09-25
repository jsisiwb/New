/** The permanent database's two safety fixes (ADR-0080): libpq sslmode semantics and the reset guard. */
import { describe, expect, it } from 'vitest';
import { withLibpqSslSemantics } from './client.js';
import { resetAllowed } from './migrate.js';

describe('sslmode keeps its libpq meaning (ADR-0080)', () => {
  it('adds uselibpqcompat only when sslmode is set and compat is not', () => {
    expect(withLibpqSslSemantics('postgres://u:p@h:5432/db?sslmode=require')).toBe(
      'postgres://u:p@h:5432/db?sslmode=require&uselibpqcompat=true',
    );
    expect(withLibpqSslSemantics('postgres://u:p@h:5432/db')).toBe('postgres://u:p@h:5432/db');
    expect(withLibpqSslSemantics('postgres://h/db?sslmode=verify-full&uselibpqcompat=false')).toBe(
      'postgres://h/db?sslmode=verify-full&uselibpqcompat=false',
    );
  });
});

describe('reset guard (ADR-0080)', () => {
  it('allows test, drill and harness databases and refuses a permanent one', () => {
    expect(resetAllowed('yeonjae_test', {})).toBe(true);
    expect(resetAllowed('yeonjae_drill_abc123_source', {})).toBe(true);
    expect(resetAllowed('yeonjae_mp_k3j9x0a2', {})).toBe(true);
    expect(resetAllowed('yeonjae', {})).toBe(false);
    expect(resetAllowed('novels', {})).toBe(false);
    expect(resetAllowed('yeonjae', { YEONJAE_ALLOW_DB_RESET: '1' })).toBe(true);
  });
});
