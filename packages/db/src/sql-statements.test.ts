import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationsDir } from './migrate.js';
import {
  isPrivilegeStatement,
  migrationChangesPrivileges,
  splitSqlStatements,
} from './sql-statements.js';

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons only', () => {
    const s = splitSqlStatements(
      `SELECT 'a;b'; SELECT "x;y" FROM t; DO $body$ BEGIN PERFORM 1; END $body$; -- tail; comment\n`,
    );
    expect(s.map((x) => x.keywords[0])).toEqual(['SELECT', 'SELECT', 'DO']);
    expect(s[2]?.dollarBodies).toEqual([' BEGIN PERFORM 1; END ']);
  });

  it('drops line and nested block comments from the keyword scan', () => {
    const s = splitSqlStatements(
      `/* outer /* GRANT inner */ still comment */ -- GRANT\nCREATE TABLE t (a int);`,
    );
    expect(s).toHaveLength(1);
    expect(s[0]?.keywords.slice(0, 2)).toEqual(['CREATE', 'TABLE']);
    expect(s[0]?.words).not.toContain('GRANT');
  });

  it("keeps `--` inside a string and reads '' and E'\\'' escapes", () => {
    const s = splitSqlStatements(`SELECT '-- not a comment', 'it''s', E'a\\'b'; SELECT 2;`);
    expect(s).toHaveLength(2);
    expect(s[0]?.strings).toEqual(['-- not a comment', "it's", "a'b"]);
  });

  it('does not read a dollar sign inside an identifier as a quote', () => {
    const s = splitSqlStatements('SELECT a$b FROM t; SELECT 1;');
    expect(s).toHaveLength(2);
  });
});

describe('privilege statements', () => {
  const one = (sql: string): boolean => {
    const [s] = splitSqlStatements(sql);
    if (!s) throw new Error('no statement');
    return isPrivilegeStatement(s);
  };

  it('recognises GRANT, REVOKE and ALTER DEFAULT PRIVILEGES', () => {
    expect(one('GRANT SELECT ON t TO yeonjae_app')).toBe(true);
    expect(one('revoke all on t from public')).toBe(true);
    expect(one('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO r')).toBe(true);
  });

  it('ignores a comment, a string, a column or a function body that mentions grant', () => {
    expect(
      migrationChangesPrivileges(
        '-- the table keeps every other constraint and grant\nALTER TABLE t ADD CHECK (a > 0);',
      ),
    ).toBe(false);
    expect(migrationChangesPrivileges("COMMENT ON TABLE t IS 'GRANT SELECT is kept';")).toBe(false);
    expect(migrationChangesPrivileges('ALTER TABLE t ADD COLUMN grant_note text;')).toBe(false);
    expect(
      migrationChangesPrivileges(
        "CREATE FUNCTION f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'GRANT SELECT ON t TO r'; END $$;",
      ),
    ).toBe(false);
  });

  it('counts a DO block that grants directly or through EXECUTE / format', () => {
    expect(migrationChangesPrivileges('DO $$ BEGIN GRANT SELECT ON t TO r; END $$;')).toBe(true);
    expect(
      migrationChangesPrivileges(
        "DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['a'] LOOP EXECUTE format('GRANT SELECT ON %I TO r', t); END LOOP; END $$;",
      ),
    ).toBe(true);
    expect(migrationChangesPrivileges("DO $$ BEGIN RAISE NOTICE 'GRANT is kept'; END $$;")).toBe(
      false,
    );
  });

  it('classifies the repository migrations: 0022 and 0020 change no privilege, 0013 and 0010 do', () => {
    const dir = migrationsDir();
    const verdict = new Map(
      readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => [
          f.slice(0, 4),
          migrationChangesPrivileges(readFileSync(join(dir, f), 'utf8')),
        ]),
    );
    expect(verdict.get('0022')).toBe(false);
    expect(verdict.get('0020')).toBe(false);
    expect(verdict.get('0013')).toBe(true);
    expect(verdict.get('0010')).toBe(true);
    expect(verdict.get('0007')).toBe(true);
  });
});
