# ADR-0071: Deterministic integration suites, a policy-hash check and lexed migration analysis

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** engineering
- **Relates to:** ADR-0041 (pinned Production Policy), ADR-0048 (atomic lease fencing), ADR-0049 (active
  cancellation), ADR-0050 (database least privilege), ADR-0070

## Context

Three integration tests failed intermittently on correct code (seen on the former PRs #9 and #10 and in
earlier tranches), each for a reason in the test, not the product:

1. `active-cancellation … a fenced-out run commits nothing` read the canon-commit count **before** releasing
   and stealing the lease. The run kept going in between, and its legitimately fenced commits landed after
   the read (`expected 2 to be +0`).
2. `multiprocess … no leftover connections` counted database backends once, right after a child exited. A
   server backend exits after its client (Terminate or SIGKILL), so its `pg_stat_activity` row could still
   be there; the query also counted the parent pool's own idle connections (`expected 1 to be +0`).
3. `lease-fence … serializes a concurrent steal` slept 50 ms before stealing and compared JS-side flags.
   Under load the steal could start before the fenced transaction held its share lock, and the steal's
   reply could be read before the COMMIT's (PostgreSQL releases locks before it answers the committing
   client).

Separately, a Production Policy whose `name` was edited (an ADR renumbering) kept its old `content_hash`,
and every process that loaded the policies crashed; and the migration-replay suite decided whether the
newest migration changes privileges with a regular expression over the file, which matched "grant" in a
comment of migration 0022 and would match a string literal or a `--` inside one.

## Decision

1. **Synchronise on the event, never on time.** The fenced-out test counts commits after the rival holds
   the lease (a commit in flight holds the lease row `FOR SHARE`, so the rival waits for it). The leak
   check tags the parent's connections (`application_name`) and waits, with a deadline, for every other
   client backend to leave `pg_stat_activity`. The steal test launches the steal inside the fenced
   transaction and commits only after `pg_blocking_pids` shows the steal waiting on it. No retry wraps any
   test; each suite is run 20 times in a loop as evidence.
2. **`pnpm policy:rehash --check`** recomputes every policy's canonical hash and fails on a stale one; it
   runs inside `check:types-fresh`, so both `pnpm check` and the CI step that already runs
   `check:types-fresh` fail on a stale hash (the agent's GitHub App cannot edit workflow files). Without `--check` it rewrites only the hash string, and
   refuses a file whose semantic content (everything but `name`, `notes`, `content_hash`) differs from the
   committed version, because a pinned policy is never mutated.
3. **Migrations are lexed, not grepped.** `splitSqlStatements` splits on top-level `;` outside quotes,
   dollar quotes and (nested) comments; `migrationChangesPrivileges` counts a statement that leads with
   `GRANT`, `REVOKE` or `ALTER DEFAULT PRIVILEGES`, or a `DO` block that runs one directly or through
   `EXECUTE`/`format`. Function bodies do not count: `CREATE FUNCTION` does not run them.

## Alternatives considered

- **Retrying flaky tests** (`retry: 2`) — rejected: it hides the race and makes a real regression rarer
  to see, not impossible.
- **Longer sleeps** — rejected for the same reason; the lock graph and `pg_stat_activity` are observable.
- **Dropping the privilege-relevance sanity check** — rejected: it is what catches a no-op privilege
  migration.

## Consequences

- The three suites are deterministic on a correct implementation; a broken implementation still fails
  (a steal that never waits fails the barrier; a leaked connection never leaves `pg_stat_activity`).
- A stale policy hash fails CI before any process loads it.
- A migration comment or string that mentions GRANT no longer changes what the replay suite checks.
