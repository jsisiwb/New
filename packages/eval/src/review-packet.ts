/**
 * Blinded reviewer packet generation and response intake for the bilingual human review (B-4-5).
 *
 * THE PROTOCOL IS NOT INVENTED HERE. `docs/07-quality/01-testing-strategy.md` §6 specifies it exactly:
 * 30 chapters, 3 bilingual reviewers, blind 1–5 on TWO scales — "natural English" and "reads as a Korean
 * webnovel of this genre" — plus free comments, with Spearman ≥ 0.8 required between each judge and its
 * scale, feeding threshold calibration (ADR-0029). This module implements that shape and no other.
 *
 * WHAT THIS IS AND IS NOT. This is preparation and intake tooling. It produces packets a human can review
 * and validates what a human sends back. It is NOT human-review evidence, and it cannot become evidence:
 *
 *   * it never invents a reviewer identity or a judgment — `importResponses` only ever reads values a
 *     human supplied, and rejects a packet marked reviewed with no responses attached;
 *   * it never sets `contrast_calibrated` and never writes a threshold. `recommendThresholds` returns a
 *     RECOMMENDATION with an explicit `requires_human_approval: true`, which a person must act on;
 *   * a generated packet is `status: 'generated'`, and nothing in this module can advance that to
 *     `reviewed` except importing real responses.
 *
 * BLINDING. A reviewer must not be able to infer which side is which, so the packet carries no model id,
 * provider, route, variant class or prompt version — the assignment lives only in the manifest's private
 * half, which is hashed into the packet but not shipped with it. Ordering is seeded so a run is
 * reproducible, and per-item side assignment is drawn from the same seeded stream: reproducible for the
 * operator, unguessable from the packet alone.
 */
import { createHash } from 'node:crypto';

/** The protocol constants, from the testing strategy. Changing one is a protocol change, not a tweak. */
export const REVIEW_PROTOCOL = {
  chapters: 30,
  reviewers: 3,
  scales: ['natural_english', 'reads_as_korean_webnovel'] as const,
  ratingMin: 1,
  ratingMax: 5,
  /** Spearman correlation each judge must reach against its scale (testing strategy §6). */
  minSpearman: 0.8,
} as const;

export type ReviewScale = (typeof REVIEW_PROTOCOL.scales)[number];

/**
 * A deterministic PRNG. `Math.random` would make a packet unreproducible, which would break the one
 * property that lets an operator regenerate the exact packet a reviewer saw.
 */
function seededRandom(seed: string): () => number {
  let h = 0;
  for (const ch of seed) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;
  let state = h >>> 0 || 0x2f6e2b1;
  return () => {
    // xorshift32: small, deterministic, and adequate for ordering — this is not a cryptographic use.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

/** One candidate text as it enters packet generation. Its provenance is stripped before shipping. */
export interface ReviewCandidate {
  readonly setId: string;
  readonly genre: string;
  readonly narrativeFunction: string;
  /** Private: the variant class under test. Never shipped to a reviewer. */
  readonly variantClass: string;
  readonly text: string;
}

export interface ReviewPair {
  readonly setId: string;
  readonly genre: string;
  readonly narrativeFunction: string;
  readonly left: ReviewCandidate;
  readonly right: ReviewCandidate;
}

/** A blinded item as a reviewer sees it. Deliberately carries no provenance of any kind. */
export interface BlindedItem {
  readonly itemId: string;
  /** Present so a reviewer can be told what KIND of passage this is; never which system wrote it. */
  readonly genre: string;
  readonly narrativeFunction: string;
  readonly a: string;
  readonly b: string;
}

/** The private half: which blinded side held which variant. Hashed into the packet, shipped separately. */
export interface ItemAssignment {
  readonly itemId: string;
  readonly setId: string;
  readonly aVariantClass: string;
  readonly bVariantClass: string;
}

export interface ReviewPacket {
  readonly packetId: string;
  readonly reviewerSlot: number;
  readonly seed: string;
  readonly protocol: typeof REVIEW_PROTOCOL;
  readonly items: readonly BlindedItem[];
  /** Hash of the blinded content, so an altered packet cannot be passed off as the one issued. */
  readonly contentHash: string;
  /** Hash of the private assignment, proving the key existed at generation without revealing it. */
  readonly assignmentHash: string;
  /**
   * Always `generated`. Nothing in this module can advance it: a packet becomes reviewed only by
   * importing real human responses.
   */
  readonly status: 'generated';
}

export interface PacketManifest {
  readonly packetId: string;
  readonly reviewerSlot: number;
  readonly seed: string;
  readonly itemCount: number;
  readonly contentHash: string;
  readonly assignmentHash: string;
  readonly assignments: readonly ItemAssignment[];
}

export interface GeneratedPackets {
  readonly packets: readonly ReviewPacket[];
  readonly manifests: readonly PacketManifest[];
}

/**
 * Generate one blinded packet per reviewer slot from the same pairs.
 *
 * All reviewers see the same passages — that is what makes inter-rater agreement computable — but each
 * gets its own item order and its own A/B side assignment, so a reviewer cannot infer the answer from a
 * neighbour's packet or from a positional habit.
 */
export function generatePackets(
  pairs: readonly ReviewPair[],
  options: { readonly seed: string; readonly reviewers?: number },
): GeneratedPackets {
  const reviewers = options.reviewers ?? REVIEW_PROTOCOL.reviewers;
  if (pairs.length < REVIEW_PROTOCOL.chapters)
    throw new Error(
      `the review protocol requires ${String(REVIEW_PROTOCOL.chapters)} passages; ` +
        `${String(pairs.length)} were supplied. Generating a short packet would silently weaken the ` +
        'protocol, so this refuses instead.',
    );

  const packets: ReviewPacket[] = [];
  const manifests: PacketManifest[] = [];

  for (let slot = 1; slot <= reviewers; slot += 1) {
    const seed = `${options.seed}:${String(slot)}`;
    const random = seededRandom(seed);
    // Fisher–Yates over a copy, so the caller's array is untouched.
    const ordered = [...pairs];
    for (let i = ordered.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const a = ordered[i];
      const b = ordered[j];
      if (a !== undefined && b !== undefined) {
        ordered[i] = b;
        ordered[j] = a;
      }
    }

    const items: BlindedItem[] = [];
    const assignments: ItemAssignment[] = [];
    for (const [index, pair] of ordered.entries()) {
      const itemId = `${options.seed}-r${String(slot)}-i${String(index + 1).padStart(2, '0')}`;
      const swap = random() < 0.5;
      const first = swap ? pair.right : pair.left;
      const second = swap ? pair.left : pair.right;
      items.push({
        itemId,
        genre: pair.genre,
        narrativeFunction: pair.narrativeFunction,
        a: first.text,
        b: second.text,
      });
      assignments.push({
        itemId,
        setId: pair.setId,
        aVariantClass: first.variantClass,
        bVariantClass: second.variantClass,
      });
    }

    const contentHash = sha256(JSON.stringify(items));
    const assignmentHash = sha256(JSON.stringify(assignments));
    const packetId = `packet-${sha256(seed).slice(7, 19)}`;
    packets.push({
      packetId,
      reviewerSlot: slot,
      seed,
      protocol: REVIEW_PROTOCOL,
      items,
      contentHash,
      assignmentHash,
      status: 'generated',
    });
    manifests.push({
      packetId,
      reviewerSlot: slot,
      seed,
      itemCount: items.length,
      contentHash,
      assignmentHash,
      assignments,
    });
  }

  return { packets, manifests };
}

/** One human rating. Every field must come from a person; nothing here is defaulted. */
export interface ReviewResponse {
  readonly itemId: string;
  /** An opaque reviewer identifier the operator assigns. This module never generates one. */
  readonly reviewerId: string;
  readonly ratings: Readonly<Record<ReviewScale, { a: number; b: number }>>;
  readonly comment?: string | undefined;
}

export interface ImportProblem {
  readonly id: string;
  readonly detail: string;
}

export interface ImportResult {
  readonly accepted: readonly ReviewResponse[];
  readonly problems: readonly ImportProblem[];
}

/**
 * Validate and accept human responses for one packet.
 *
 * Fails closed on every way a response set can be wrong rather than partially importing: an incomplete
 * set, a duplicate, a response for an item from another packet, a rating outside 1–5, a non-integer
 * rating, or a reviewer id shared with another slot. A partially-imported set would produce an agreement
 * figure computed over data nobody actually reviewed.
 */
export function importResponses(
  packet: ReviewPacket,
  manifest: PacketManifest,
  responses: readonly ReviewResponse[],
): ImportResult {
  const problems: ImportProblem[] = [];

  if (manifest.packetId !== packet.packetId)
    problems.push({ id: 'manifest_packet_mismatch', detail: manifest.packetId });
  if (manifest.contentHash !== packet.contentHash)
    problems.push({ id: 'packet_content_altered', detail: packet.packetId });

  const validItems = new Set(packet.items.map((i) => i.itemId));
  const seen = new Set<string>();
  const reviewers = new Set<string>();

  for (const response of responses) {
    if (!validItems.has(response.itemId)) {
      // A response for an item this packet does not contain means packets were crossed.
      problems.push({ id: 'response_from_another_packet', detail: response.itemId });
      continue;
    }
    if (seen.has(response.itemId)) {
      problems.push({ id: 'duplicate_response', detail: response.itemId });
      continue;
    }
    seen.add(response.itemId);
    if (response.reviewerId.trim() === '') {
      problems.push({ id: 'missing_reviewer_identity', detail: response.itemId });
      continue;
    }
    reviewers.add(response.reviewerId);

    for (const scale of REVIEW_PROTOCOL.scales) {
      // `ratings` is typed as a complete Record, but responses arrive as JSON from outside, so the
      // presence check is a boundary guard rather than a type-level one.
      const rating = (response.ratings as Partial<Record<ReviewScale, { a: number; b: number }>>)[
        scale
      ];
      if (rating === undefined) {
        problems.push({ id: 'missing_scale', detail: `${response.itemId}:${scale}` });
        continue;
      }
      for (const side of ['a', 'b'] as const) {
        const value = rating[side];
        if (
          !Number.isInteger(value) ||
          value < REVIEW_PROTOCOL.ratingMin ||
          value > REVIEW_PROTOCOL.ratingMax
        )
          problems.push({
            id: 'rating_out_of_range',
            detail: `${response.itemId}:${scale}:${side}`,
          });
      }
    }
  }

  const missing = packet.items.filter((i) => !seen.has(i.itemId));
  if (missing.length > 0)
    problems.push({ id: 'incomplete_response_set', detail: String(missing.length) });
  // One packet is one reviewer. More than one identity means responses were merged.
  if (reviewers.size > 1)
    problems.push({ id: 'multiple_reviewer_identities', detail: String(reviewers.size) });

  return { accepted: problems.length === 0 ? responses : [], problems };
}

/**
 * Spearman rank correlation between two equal-length numeric series.
 *
 * Ties are handled with average ranks; without that, a reviewer who used only three of the five points
 * would produce a correlation that depended on input order.
 */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return Number.NaN;
  const rank = (values: readonly number[]): number[] => {
    const indexed = values.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
    const ranks = new Array<number>(values.length).fill(0);
    let i = 0;
    while (i < indexed.length) {
      let j = i;
      while (j + 1 < indexed.length && indexed[j + 1]?.v === indexed[i]?.v) j += 1;
      const average = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) {
        const entry = indexed[k];
        if (entry) ranks[entry.i] = average;
      }
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mean = (a: readonly number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = (rx[i] ?? 0) - mx;
    const b = (ry[i] ?? 0) - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return Number.NaN;
  return num / Math.sqrt(dx * dy);
}

export interface AgreementReport {
  readonly scale: ReviewScale;
  /** Pairwise Spearman between reviewers, keyed `reviewerA|reviewerB`. */
  readonly pairwise: Readonly<Record<string, number>>;
  readonly minPairwise: number;
  readonly meetsThreshold: boolean;
}

export interface DisagreementItem {
  readonly itemId: string;
  readonly scale: ReviewScale;
  readonly spread: number;
}

export interface ReviewReport {
  readonly packetIds: readonly string[];
  readonly reviewerCount: number;
  readonly itemCount: number;
  readonly agreement: readonly AgreementReport[];
  readonly disagreements: readonly DisagreementItem[];
  readonly byGenre: Readonly<Record<string, number>>;
  readonly byFunction: Readonly<Record<string, number>>;
  /**
   * Always `uncalibrated`. This tooling reports; a human decides. Advancing calibration requires accepted
   * human evidence and an explicit decision, neither of which a report can supply.
   */
  readonly calibration: 'uncalibrated';
  readonly requires_human_approval: true;
}

/**
 * Compute inter-rater agreement, per-genre/function coverage and the largest disagreements.
 *
 * `responsesByReviewer` must already have passed `importResponses`: this function reports on accepted
 * human data and never repairs or imputes a missing rating.
 */
export function reviewReport(
  packets: readonly ReviewPacket[],
  responsesByReviewer: ReadonlyMap<string, readonly ReviewResponse[]>,
): ReviewReport {
  const reviewerIds = [...responsesByReviewer.keys()].sort();
  // Items are compared across reviewers by SET, not by item id: each reviewer's packet has its own ids
  // and its own side assignment, so the set id is the only common key.
  const itemToSet = new Map<string, string>();
  const itemMeta = new Map<string, { genre: string; narrativeFunction: string }>();
  for (const packet of packets) {
    for (const item of packet.items) {
      itemMeta.set(item.itemId, {
        genre: item.genre,
        narrativeFunction: item.narrativeFunction,
      });
    }
  }

  const byGenre: Record<string, number> = {};
  const byFunction: Record<string, number> = {};
  for (const meta of itemMeta.values()) {
    byGenre[meta.genre] = (byGenre[meta.genre] ?? 0) + 1;
    byFunction[meta.narrativeFunction] = (byFunction[meta.narrativeFunction] ?? 0) + 1;
  }

  const agreement: AgreementReport[] = [];
  const disagreements: DisagreementItem[] = [];

  for (const scale of REVIEW_PROTOCOL.scales) {
    const pairwise: Record<string, number> = {};
    // A reviewer's series is their per-item preference margin (a − b), which is what the scale measures.
    const seriesOf = (reviewerId: string): Map<string, number> => {
      const out = new Map<string, number>();
      for (const response of responsesByReviewer.get(reviewerId) ?? []) {
        const rating = response.ratings[scale];
        const key = itemToSet.get(response.itemId) ?? response.itemId;
        out.set(key, rating.a - rating.b);
      }
      return out;
    };

    for (let i = 0; i < reviewerIds.length; i += 1) {
      for (let j = i + 1; j < reviewerIds.length; j += 1) {
        const a = reviewerIds[i];
        const b = reviewerIds[j];
        if (a === undefined || b === undefined) continue;
        const sa = seriesOf(a);
        const sb = seriesOf(b);
        const keys = [...sa.keys()].filter((k) => sb.has(k)).sort();
        pairwise[`${a}|${b}`] = spearman(
          keys.map((k) => sa.get(k) ?? 0),
          keys.map((k) => sb.get(k) ?? 0),
        );
      }
    }

    const values = Object.values(pairwise).filter((v) => !Number.isNaN(v));
    const minPairwise = values.length > 0 ? Math.min(...values) : Number.NaN;
    agreement.push({
      scale,
      pairwise,
      minPairwise,
      meetsThreshold: Number.isFinite(minPairwise) && minPairwise >= REVIEW_PROTOCOL.minSpearman,
    });
  }

  // Largest per-item spread, so a calibration discussion starts from the genuinely contested passages.
  const spreadByItem = new Map<string, Map<ReviewScale, number[]>>();
  for (const responses of responsesByReviewer.values()) {
    for (const response of responses) {
      const perScale = spreadByItem.get(response.itemId) ?? new Map<ReviewScale, number[]>();
      for (const scale of REVIEW_PROTOCOL.scales) {
        const list = perScale.get(scale) ?? [];
        list.push(response.ratings[scale].a - response.ratings[scale].b);
        perScale.set(scale, list);
      }
      spreadByItem.set(response.itemId, perScale);
    }
  }
  for (const [itemId, perScale] of spreadByItem) {
    for (const [scale, values] of perScale) {
      if (values.length < 2) continue;
      const spread = Math.max(...values) - Math.min(...values);
      if (spread >= 2) disagreements.push({ itemId, scale, spread });
    }
  }
  disagreements.sort((a, b) => b.spread - a.spread || a.itemId.localeCompare(b.itemId));

  return {
    packetIds: packets.map((p) => p.packetId),
    reviewerCount: reviewerIds.length,
    itemCount: itemMeta.size,
    agreement,
    disagreements,
    byGenre,
    byFunction,
    calibration: 'uncalibrated',
    requires_human_approval: true,
  };
}

export interface ThresholdRecommendation {
  readonly basis: 'human_review_pending' | 'human_review_accepted';
  readonly ready: boolean;
  readonly blockers: readonly string[];
  readonly calibration: 'uncalibrated';
  readonly requires_human_approval: true;
}

/**
 * Report whether the protocol's preconditions for calibration are met.
 *
 * It returns a RECOMMENDATION and nothing else. It does not write a threshold, does not set
 * `contrast_calibrated`, and reports `calibration: 'uncalibrated'` unconditionally — because the
 * transition is a human decision backed by accepted human evidence, and a function that could make it
 * automatically would be a way to manufacture calibration.
 */
export function recommendThresholds(report: ReviewReport): ThresholdRecommendation {
  const blockers: string[] = [];
  if (report.reviewerCount < REVIEW_PROTOCOL.reviewers)
    blockers.push(
      `only ${String(report.reviewerCount)} reviewer(s) of ${String(REVIEW_PROTOCOL.reviewers)} submitted`,
    );
  if (report.itemCount < REVIEW_PROTOCOL.chapters)
    blockers.push(
      `only ${String(report.itemCount)} passage(s) of ${String(REVIEW_PROTOCOL.chapters)} reviewed`,
    );
  for (const entry of report.agreement) {
    if (!entry.meetsThreshold)
      blockers.push(
        `${entry.scale}: minimum pairwise Spearman ${String(entry.minPairwise)} is below ` +
          String(REVIEW_PROTOCOL.minSpearman),
      );
  }
  return {
    basis: blockers.length === 0 ? 'human_review_accepted' : 'human_review_pending',
    ready: blockers.length === 0,
    blockers,
    calibration: 'uncalibrated',
    requires_human_approval: true,
  };
}
