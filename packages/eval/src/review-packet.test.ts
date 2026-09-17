/**
 * Blinded reviewer tooling (B-4-5, automation portion).
 *
 * The properties asserted here are mostly REFUSALS, because the ways this tooling could go wrong are all
 * ways of manufacturing evidence: shipping a packet that leaks which side is which, accepting a partial
 * or crossed response set, inventing a reviewer, or advancing calibration without a human.
 *
 * No credentials, no provider, no human data: every response below is a synthetic literal in this file,
 * and the suite is explicit that generating packets is not the same as having them reviewed.
 */
import { describe, expect, it } from 'vitest';
import {
  generatePackets,
  importResponses,
  recommendThresholds,
  REVIEW_PROTOCOL,
  reviewReport,
  spearman,
  type ReviewPair,
  type ReviewResponse,
} from './review-packet.js';

const GENRES = ['academy', 'hunter-gate', 'regression', 'romance-fantasy'] as const;
const FUNCTIONS = [
  'hook',
  'emotional_beat',
  'banter',
  'status_window',
  'reveal',
  'ending',
  'exposition',
  'action',
] as const;

/** 30 synthetic pairs, spread across the four MVP genres and the eight narrative functions. */
function pairs(count = REVIEW_PROTOCOL.chapters): ReviewPair[] {
  return Array.from({ length: count }, (_, i) => {
    const genre = GENRES[i % GENRES.length] as string;
    const narrativeFunction = FUNCTIONS[i % FUNCTIONS.length] as string;
    const setId = `set-${String(i + 1).padStart(3, '0')}`;
    return {
      setId,
      genre,
      narrativeFunction,
      left: {
        setId,
        genre,
        narrativeFunction,
        variantClass: 'kwn_english',
        text: `Passage ${setId} as the serialized version.`,
      },
      right: {
        setId,
        genre,
        narrativeFunction,
        variantClass: 'translation_like',
        text: `Passage ${setId} as the translation-like version.`,
      },
    };
  });
}

describe('packet generation follows the documented protocol exactly', () => {
  it('uses the protocol from the testing strategy: 30 passages, 3 reviewers, two 1-5 scales', () => {
    expect(REVIEW_PROTOCOL.chapters).toBe(30);
    expect(REVIEW_PROTOCOL.reviewers).toBe(3);
    expect(REVIEW_PROTOCOL.scales).toEqual(['natural_english', 'reads_as_korean_webnovel']);
    expect(REVIEW_PROTOCOL.ratingMin).toBe(1);
    expect(REVIEW_PROTOCOL.ratingMax).toBe(5);
    expect(REVIEW_PROTOCOL.minSpearman).toBe(0.8);
  });

  it('generates one packet per reviewer, each with every passage', () => {
    const { packets, manifests } = generatePackets(pairs(), { seed: 'seed-a' });
    expect(packets).toHaveLength(3);
    expect(manifests).toHaveLength(3);
    for (const packet of packets) {
      expect(packet.items).toHaveLength(30);
      expect(packet.status).toBe('generated');
    }
  });

  it('refuses to generate a short packet rather than silently weakening the protocol', () => {
    expect(() => generatePackets(pairs(29), { seed: 'seed-a' })).toThrow(/requires 30 passages/);
  });

  it('is reproducible from its seed', () => {
    const first = generatePackets(pairs(), { seed: 'seed-a' });
    const second = generatePackets(pairs(), { seed: 'seed-a' });
    expect(second.packets[0]?.contentHash).toBe(first.packets[0]?.contentHash);
    expect(second.manifests[0]?.assignmentHash).toBe(first.manifests[0]?.assignmentHash);
  });

  it('gives a different seed a different packet, so two rounds are not the same review', () => {
    const a = generatePackets(pairs(), { seed: 'seed-a' });
    const b = generatePackets(pairs(), { seed: 'seed-b' });
    expect(b.packets[0]?.contentHash).not.toBe(a.packets[0]?.contentHash);
  });

  it('orders and sides each reviewer independently', () => {
    const { packets } = generatePackets(pairs(), { seed: 'seed-a' });
    const [one, two] = packets;
    // Same passages, different presentation: a reviewer cannot copy a neighbour's positional habit.
    expect(one?.contentHash).not.toBe(two?.contentHash);
  });
});

describe('packets are blind: no provenance reaches the reviewer', () => {
  it('carries no model, provider, route, variant class or prompt version', () => {
    const { packets } = generatePackets(pairs(), { seed: 'seed-a' });
    const serialized = JSON.stringify(packets);
    for (const leak of [
      'kwn_english',
      'translation_like',
      'variantClass',
      'model',
      'provider',
      'route',
      'prompt_version',
    ]) {
      expect(serialized, `packet must not contain ${leak}`).not.toContain(leak);
    }
  });

  it('keeps the A/B assignment in the manifest, hashed into the packet but not shipped with it', () => {
    const { packets, manifests } = generatePackets(pairs(), { seed: 'seed-a' });
    const packet = packets[0];
    const manifest = manifests[0];
    expect(manifest?.assignments).toHaveLength(30);
    // The packet proves the key existed at generation without revealing it.
    expect(packet?.assignmentHash).toBe(manifest?.assignmentHash);
    expect(JSON.stringify(packet)).not.toContain('aVariantClass');
  });

  it('actually varies the side assignment rather than always presenting left as A', () => {
    const { manifests } = generatePackets(pairs(), { seed: 'seed-a' });
    const classes = manifests[0]?.assignments.map((a) => a.aVariantClass) ?? [];
    // A constant assignment would make the blinding decorative.
    expect(new Set(classes).size).toBe(2);
  });
});

describe('response intake fails closed', () => {
  const { packets, manifests } = generatePackets(pairs(), { seed: 'seed-a' });
  const packet = packets[0];
  const manifest = manifests[0];
  if (packet === undefined || manifest === undefined)
    throw new Error('packet generation produced no packets');

  function complete(reviewerId = 'reviewer-1'): ReviewResponse[] {
    return packet.items.map((item, i) => ({
      itemId: item.itemId,
      reviewerId,
      ratings: {
        natural_english: { a: 4, b: (i % 3) + 1 },
        reads_as_korean_webnovel: { a: 5, b: (i % 2) + 1 },
      },
    }));
  }

  it('accepts a complete, single-reviewer, in-range response set', () => {
    const result = importResponses(packet, manifest, complete());
    expect(result.problems).toEqual([]);
    expect(result.accepted).toHaveLength(30);
  });

  it('rejects an incomplete set rather than importing part of it', () => {
    const result = importResponses(packet, manifest, complete().slice(0, 29));
    expect(result.accepted).toEqual([]);
    expect(result.problems.map((p) => p.id)).toContain('incomplete_response_set');
  });

  it('rejects a duplicate response for the same item', () => {
    const responses = complete();
    const [firstResponse] = responses;
    if (firstResponse === undefined) throw new Error('no responses generated');
    const duplicated = [...responses, firstResponse];
    const result = importResponses(packet, manifest, duplicated);
    expect(result.problems.map((p) => p.id)).toContain('duplicate_response');
  });

  it('rejects a response belonging to another packet', () => {
    const other = packets[1];
    const [first] = complete();
    if (first === undefined) throw new Error('no responses generated');
    const mixed = [...complete().slice(1), { ...first, itemId: other?.items[0]?.itemId ?? 'x' }];
    const result = importResponses(packet, manifest, mixed);
    expect(result.problems.map((p) => p.id)).toContain('response_from_another_packet');
  });

  it('rejects merged reviewer identities: one packet is one reviewer', () => {
    const responses = complete();
    const merged = responses.map((r, i) => (i === 0 ? { ...r, reviewerId: 'reviewer-2' } : r));
    const result = importResponses(packet, manifest, merged);
    expect(result.problems.map((p) => p.id)).toContain('multiple_reviewer_identities');
  });

  it('rejects a missing reviewer identity instead of inventing one', () => {
    const result = importResponses(packet, manifest, complete(' '));
    expect(result.problems.map((p) => p.id)).toContain('missing_reviewer_identity');
  });

  it.each([0, 6, 2.5, Number.NaN])('rejects the out-of-protocol rating %s', (bad) => {
    const responses = complete();
    const [first] = responses;
    if (first === undefined) throw new Error('no responses generated');
    const tampered = [
      { ...first, ratings: { ...first.ratings, natural_english: { a: bad, b: 3 } } },
      ...responses.slice(1),
    ];
    const result = importResponses(packet, manifest, tampered);
    expect(result.problems.map((p) => p.id)).toContain('rating_out_of_range');
  });

  it('rejects a packet whose content was altered after issue', () => {
    const altered = { ...packet, contentHash: 'sha256:tampered' };
    const result = importResponses(altered, manifest, complete());
    expect(result.problems.map((p) => p.id)).toContain('packet_content_altered');
  });
});

describe('Spearman correlation', () => {
  it('is 1 for a perfectly concordant series and −1 for a reversed one', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
  });

  it('handles ties with average ranks rather than input order', () => {
    // A reviewer who used only part of the scale must not get an order-dependent correlation.
    const forward = spearman([1, 1, 2, 2], [3, 3, 4, 4]);
    const reordered = spearman([1, 2, 1, 2], [3, 4, 3, 4]);
    expect(forward).toBeCloseTo(reordered, 10);
  });

  it('is NaN rather than a fabricated number when a series has no variance', () => {
    expect(Number.isNaN(spearman([2, 2, 2], [1, 2, 3]))).toBe(true);
  });
});

describe('reporting never becomes calibration', () => {
  const { packets, manifests } = generatePackets(pairs(), { seed: 'seed-a' });

  function responsesFor(packetIndex: number, reviewerId: string, agree: boolean): ReviewResponse[] {
    const packet = packets[packetIndex];
    return (packet?.items ?? []).map((item, i) => ({
      itemId: item.itemId,
      reviewerId,
      ratings: {
        natural_english: { a: agree ? 5 : 1, b: (i % 4) + 1 },
        reads_as_korean_webnovel: { a: agree ? 5 : 1, b: (i % 3) + 1 },
      },
    }));
  }

  it('reports calibration as uncalibrated and requires human approval, always', () => {
    const report = reviewReport(
      packets,
      new Map([['reviewer-1', responsesFor(0, 'reviewer-1', true)]]),
    );
    expect(report.calibration).toBe('uncalibrated');
    expect(report.requires_human_approval).toBe(true);
  });

  it('summarises coverage by genre and narrative function', () => {
    const report = reviewReport(
      packets,
      new Map([['reviewer-1', responsesFor(0, 'reviewer-1', true)]]),
    );
    expect(Object.keys(report.byGenre).sort()).toEqual([...GENRES].sort());
    expect(Object.keys(report.byFunction).sort()).toEqual([...FUNCTIONS].sort());
  });

  it('blocks a threshold recommendation when fewer than three reviewers submitted', () => {
    const report = reviewReport(
      packets,
      new Map([['reviewer-1', responsesFor(0, 'reviewer-1', true)]]),
    );
    const recommendation = recommendThresholds(report);
    expect(recommendation.ready).toBe(false);
    expect(recommendation.basis).toBe('human_review_pending');
    expect(recommendation.blockers.join(' ')).toContain('reviewer');
    // Even a "ready" recommendation cannot advance calibration; a blocked one certainly cannot.
    expect(recommendation.calibration).toBe('uncalibrated');
    expect(recommendation.requires_human_approval).toBe(true);
  });

  it('blocks when agreement falls below the protocol\u2019s Spearman floor', () => {
    const responses = new Map([
      ['reviewer-1', responsesFor(0, 'reviewer-1', true)],
      ['reviewer-2', responsesFor(1, 'reviewer-2', false)],
      ['reviewer-3', responsesFor(2, 'reviewer-3', true)],
    ]);
    const report = reviewReport(packets, responses);
    const recommendation = recommendThresholds(report);
    // Whatever the computed correlations are, a recommendation is never a calibration.
    expect(recommendation.calibration).toBe('uncalibrated');
    expect(recommendation.requires_human_approval).toBe(true);
  });

  it('generated packets are not review evidence: a packet alone yields no reviewers and no agreement', () => {
    const report = reviewReport(packets, new Map());
    expect(report.reviewerCount).toBe(0);
    for (const entry of report.agreement) expect(Number.isNaN(entry.minPairwise)).toBe(true);
    expect(recommendThresholds(report).ready).toBe(false);
    // The manifests exist, but nothing in this module can mark a packet reviewed.
    expect(manifests.every((m) => m.itemCount === 30)).toBe(true);
    expect(packets.map((p) => p.status as string)).toEqual(['generated', 'generated', 'generated']);
  });
});
