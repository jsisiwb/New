/**
 * Safety guards for the disposable restore drill (B-4-3).
 *
 * These are the checks that stand between a drill and a data-loss incident, so they are proved rather
 * than assumed. Every case below is a way an operator could plausibly point the drill at something it
 * must refuse: a remote host, a production-looking name, a missing acknowledgement, a database the drill
 * did not create, a URL it cannot parse.
 *
 * No database and no credentials are involved: these are pure functions over connection strings.
 */
import { describe, expect, it } from 'vitest';
import {
  assessDestructiveTarget,
  assessSourceTarget,
  assertDestructiveTargetSafe,
  assertSourceSafe,
  describeTarget,
  drillDatabaseName,
  isLocalHost,
  nameIsMarkedDisposable,
  nameLooksProtected,
  parseDatabaseTarget,
  redactConnectionUrl,
  urlForDatabase,
} from './restore-safety.js';

const LOCAL_DISPOSABLE = 'postgres://op:secretpw@127.0.0.1:5432/yeonjae_drill_abc_restored';

describe('restore drill safety: destructive targets are refused unless provably disposable', () => {
  it('accepts a local, explicitly disposable database that the drill created and acknowledged', () => {
    const verdict = assessDestructiveTarget({
      url: LOCAL_DISPOSABLE,
      acknowledged: true,
      createdByDrill: ['yeonjae_drill_abc_restored'],
    });
    expect(verdict).toEqual({ safe: true, reasons: [] });
  });

  it('refuses a remote host even when every other signal says disposable', () => {
    const verdict = assessDestructiveTarget({
      url: 'postgres://op:pw@db.example.com:5432/yeonjae_drill_abc_restored',
      acknowledged: true,
    });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toContain('host_not_local');
  });

  it('refuses a production-looking name even when it also carries a disposable marker', () => {
    // Ambiguity resolves to refusal: `prod` and `drill` in one name is not a safe target.
    const verdict = assessDestructiveTarget({
      url: 'postgres://op:pw@127.0.0.1:5432/prod_drill_restore',
      acknowledged: true,
    });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toContain('database_name_looks_protected');
  });

  it.each(['yeonjae_production', 'app_staging', 'customer_data', 'main', 'tenant_store'])(
    'refuses the protected database name %s',
    (db) => {
      const verdict = assessDestructiveTarget({
        url: `postgres://op:pw@127.0.0.1:5432/${db}`,
        acknowledged: true,
      });
      expect(verdict.safe).toBe(false);
    },
  );

  it('refuses a database with no disposable marker at all', () => {
    const verdict = assessDestructiveTarget({
      url: 'postgres://op:pw@127.0.0.1:5432/yeonjae_test',
      acknowledged: true,
    });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toContain('database_name_not_marked_disposable');
  });

  it('requires an explicit acknowledgement separate from a safe URL', () => {
    const verdict = assessDestructiveTarget({ url: LOCAL_DISPOSABLE, acknowledged: false });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toEqual(['destructive_action_not_acknowledged']);
  });

  it('refuses a disposable database this drill did not create', () => {
    const verdict = assessDestructiveTarget({
      url: LOCAL_DISPOSABLE,
      acknowledged: true,
      createdByDrill: ['yeonjae_drill_other_restored'],
    });
    expect(verdict.safe).toBe(false);
    expect(verdict.reasons).toContain('database_not_created_by_this_drill');
  });

  it('reports every failing reason at once rather than only the first', () => {
    const verdict = assessDestructiveTarget({
      url: 'postgres://op:pw@db.example.com:5432/production',
      acknowledged: false,
    });
    expect(verdict.reasons).toEqual(
      expect.arrayContaining([
        'host_not_local',
        'database_name_looks_protected',
        'database_name_not_marked_disposable',
        'destructive_action_not_acknowledged',
      ]),
    );
  });

  it('never trusts NODE_ENV: a production URL stays unsafe while NODE_ENV claims test', () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'test';
      const verdict = assessDestructiveTarget({
        url: 'postgres://op:pw@db.example.com:5432/production',
        acknowledged: true,
      });
      expect(verdict.safe).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('refuses an unparseable URL rather than guessing its parts', () => {
    expect(assessDestructiveTarget({ url: 'not a url', acknowledged: true })).toEqual({
      safe: false,
      reasons: ['url_unparseable'],
    });
  });

  it('refuses a non-PostgreSQL scheme', () => {
    expect(() => parseDatabaseTarget('mysql://op:pw@127.0.0.1:3306/drill')).toThrow(
      /not a PostgreSQL URL/,
    );
  });

  it('refuses a URL that names no database', () => {
    expect(() => parseDatabaseTarget('postgres://op:pw@127.0.0.1:5432/')).toThrow(
      /names no database/,
    );
  });
});

describe('restore drill safety: credentials never appear in any rendered output', () => {
  it('describeTarget renders user, host, port and database but never the password', () => {
    const rendered = describeTarget(parseDatabaseTarget(LOCAL_DISPOSABLE));
    expect(rendered).toBe('op@127.0.0.1:5432/yeonjae_drill_abc_restored');
    expect(rendered).not.toContain('secretpw');
  });

  it('the refusal error names the redacted target and the reasons, never the URL', () => {
    let message = '';
    try {
      assertDestructiveTargetSafe({ url: LOCAL_DISPOSABLE, acknowledged: false });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('op@127.0.0.1:5432/yeonjae_drill_abc_restored');
    expect(message).toContain('destructive_action_not_acknowledged');
    expect(message).not.toContain('secretpw');
    expect(message).not.toContain('postgres://');
  });

  it('a source refusal is also redacted', () => {
    let message = '';
    try {
      assertSourceSafe('postgres://op:secretpw@db.example.com:5432/anything');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('host_not_local');
    expect(message).not.toContain('secretpw');
  });

  it('redactConnectionUrl removes the password and fails closed on garbage', () => {
    expect(redactConnectionUrl(LOCAL_DISPOSABLE)).not.toContain('secretpw');
    expect(redactConnectionUrl(LOCAL_DISPOSABLE)).toContain('REDACTED');
    expect(redactConnectionUrl('not a url')).toBe('postgres://REDACTED');
  });
});

describe('restore drill safety: name and host predicates', () => {
  it.each(['localhost', '127.0.0.1', '::1'])('treats %s as local', (host) => {
    expect(isLocalHost(host)).toBe(true);
  });

  it.each(['db.example.com', '10.0.0.5', 'rds.amazonaws.com'])('treats %s as remote', (host) => {
    expect(isLocalHost(host)).toBe(false);
  });

  it('matches disposable markers only as whole words', () => {
    expect(nameIsMarkedDisposable('yeonjae_drill_x_source')).toBe(true);
    expect(nameIsMarkedDisposable('yeonjae-scratch-1')).toBe(true);
    // A substring match would make `drillbit_customers` look disposable; it must not.
    expect(nameIsMarkedDisposable('drillbit_customers')).toBe(false);
    expect(nameIsMarkedDisposable('yeonjae_test')).toBe(false);
  });

  it('matches protected words only as whole words', () => {
    expect(nameLooksProtected('yeonjae_production')).toBe(true);
    expect(nameLooksProtected('reproduction_notes')).toBe(false);
  });

  it('generates drill names that satisfy their own marker rule and are never protected', () => {
    for (const suffix of ['source', 'restored'] as const) {
      const name = drillDatabaseName('AbC-123', suffix);
      expect(nameIsMarkedDisposable(name)).toBe(true);
      expect(nameLooksProtected(name)).toBe(false);
      expect(name).toMatch(/^[a-z0-9_]+$/);
    }
  });

  it('urlForDatabase swaps only the database and keeps the rest of the target intact', () => {
    const swapped = urlForDatabase(LOCAL_DISPOSABLE, 'yeonjae_drill_abc_source');
    const target = parseDatabaseTarget(swapped);
    expect(target.database).toBe('yeonjae_drill_abc_source');
    expect(target.host).toBe('127.0.0.1');
    expect(target.user).toBe('op');
  });
});

describe('restore drill safety: the source is read-only and still constrained', () => {
  it('accepts a local source without requiring a disposable marker', () => {
    expect(assessSourceTarget('postgres://op:pw@127.0.0.1:5432/yeonjae_test').safe).toBe(true);
  });

  it('refuses a remote source: even pg_dump against production is out of scope', () => {
    expect(assessSourceTarget('postgres://op:pw@prod.example.com:5432/yeonjae').safe).toBe(false);
  });

  it('refuses a production-named local source', () => {
    expect(assessSourceTarget('postgres://op:pw@127.0.0.1:5432/yeonjae_production').safe).toBe(
      false,
    );
  });
});
