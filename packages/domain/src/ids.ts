/**
 * UUIDv7 identifiers (AGENTS.md conventions): time-ordered so creation order is the deterministic tie-break
 * for simultaneous story clocks (ADR-0040). Uses the platform's CSPRNG; no external dependency.
 */
import { createHash, randomBytes } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Uuid = string & { readonly __brand: 'Uuid' };

export function isUuid(value: unknown): value is Uuid {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function asUuid(value: string): Uuid {
  if (!isUuid(value)) throw new TypeError(`not a UUID: ${value}`);
  return value;
}

let lastMs = 0;
let seq = 0;

export function uuidv7(now: number = Date.now()): Uuid {
  // Monotonic within a process: reuse the millisecond and bump a 12-bit sequence when the clock repeats.
  if (now === lastMs) {
    seq = (seq + 1) & 0xfff;
    if (seq === 0) now = ++lastMs;
  } else {
    lastMs = now;
    seq = randomBytes(2).readUInt16BE(0) & 0x7ff; // start low so a burst rarely wraps
  }
  const b = Buffer.alloc(16);
  b.writeUIntBE(now, 0, 6);
  b.writeUInt16BE(0x7000 | seq, 6);
  const rnd = randomBytes(8);
  rnd.copy(b, 8);
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant 10xx
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as Uuid;
}

/** Extract the millisecond timestamp encoded in a UUIDv7. */
export function uuidv7Time(id: Uuid): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

/**
 * RFC 9562 v8 UUID derived from a stable key (sha256). Used where an id must be reproducible across
 * resumed runs without a persisted allocation — chapter contracts, arcs and seasons planned from a
 * project's story plan. Same derivation shape as the content-addressed artifact and pack ids.
 */
export function uuidFromKey(key: string): Uuid {
  const hex = createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 32);
  const b = Buffer.from(hex, 'hex');
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as Uuid;
}
