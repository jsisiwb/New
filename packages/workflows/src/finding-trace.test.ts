import { uuidFromKey } from '@yeonjae/domain';
import { describe, expect, it } from 'vitest';
import {
  renderFindingTrace,
  roundFromScorecardId,
  traceFindings,
  type TraceIssue,
  type TraceScorecard,
} from './finding-trace.js';

// Synthetic tokens only: each paragraph is two words.
const text = (...paragraphs: string[]) => paragraphs.join('\n\n');

/** A finding anchored on `quote` in `body` the way anchorIssueQuote anchors it (code-point offsets). */
const at = (body: string, quote: string, over: Partial<TraceIssue> = {}): TraceIssue => {
  const start = Array.from(body.slice(0, body.indexOf(quote))).length;
  return {
    source: 'judge:continuity_checker',
    kind: 'timeline_error',
    severity: 'major',
    claim: 'synthetic claim',
    chapter_span: { start, end: start + Array.from(quote).length, quote },
    ...over,
  };
};
const spanless = (kind: string, over: Partial<TraceIssue> = {}): TraceIssue => ({
  source: 'judge:prose_judge',
  kind,
  severity: 'major',
  claim: 'synthetic claim',
  ...over,
});
const DOUBT = '(두 번째 판독에서 재현되지 않은 설정 의심) ';
const NOT_MAJOR = '(두 번째 판독에서 주요 결함으로 재현되지 않음) ';

describe('finding trace (run 4 STEP 1.1)', () => {
  const v1 = text('alpha one', 'bravo two', 'charlie three');
  const v2 = text('alpha one', 'bravo two', 'delta four');
  const chapter = {
    number: 1,
    versions: [
      { id: 'v1', version_no: 1, text: v1, quarantined: false },
      { id: 'v2', version_no: 2, text: v2, quarantined: false },
    ],
    scorecards: [
      {
        id: 'sc0',
        manuscript_version_id: 'v1',
        sections: { continuity: {}, prose: {} },
        issues: [at(v1, 'alpha one', { id: 'a0' }), spanless('weak_pacing', { id: 'p0' })],
      },
      {
        id: 'sc1',
        manuscript_version_id: 'v2',
        // The prose judge did not re-run: its finding below is a carried copy.
        sections: { continuity: {}, prose: { carried_from: 'sc0' } },
        issues: [
          at(v2, 'alpha one', { id: 'a1' }),
          at(v2, 'delta four', { id: 'd1' }),
          spanless('weak_pacing', { id: 'p1-carried' }),
          at(v2, 'bravo two', { id: 'm1', severity: 'minor' }),
        ],
      },
      {
        id: 'sc2',
        manuscript_version_id: 'v2',
        sections: { continuity: {}, prose: {} },
        issues: [
          at(v2, 'bravo two', { id: 'b2' }),
          spanless('weak_pacing', { id: 'p2' }),
          spanless('flat_voice', { id: 'q2' }),
        ],
      },
    ] satisfies TraceScorecard[],
  };

  it('classifies every span state against the evaluator’s last reading, and detects the confirmation', () => {
    const rows = traceFindings({ chapters: [chapter] });
    expect(
      rows.map((r) => [r.issue_id, r.scorecard, r.round, r.round_from, r.reading, r.span_state]),
    ).toEqual([
      ['a0', 0, 0, 'order', 'full', 'first_reading'],
      ['p0', 0, 0, 'order', 'full', 'first_reading'],
      // Minor findings and carried copies get no row.
      ['a1', 1, 1, 'order', 'targeted', 're_raised'],
      ['d1', 1, 1, 'order', 'targeted', 'changed_since_last_reading'],
      // The full re-read of the targeted scorecard's version shares its round.
      ['b2', 2, 1, 'order', 'confirmation', 'passed_unchanged'],
      // The prose judge last read the chapter in sc0, where it raised the same quoteless kind.
      ['p2', 2, 1, 'order', 'confirmation', 're_raised'],
      ['q2', 2, 1, 'order', 'confirmation', 'no_quote'],
    ]);
    expect(rows[0]).toMatchObject({
      chapter: 1,
      version_no: 1,
      quarantined: false,
      source: 'judge:continuity_checker',
      kind: 'timeline_error',
      severity: 'major',
      quote: 'alpha one',
      claim: 'synthetic claim',
      reproduced: 'single_reading',
    });
  });

  it('follows each finding into later readings: fixed, never addressed, open at the end', () => {
    const later = Object.fromEntries(
      traceFindings({ chapters: [chapter] }).map((r) => [r.issue_id ?? '', r.later] as const),
    );
    expect(later).toEqual({
      a0: 'fixed', // raised again in sc1, gone from sc2
      p0: 'never_addressed', // sc1 carried the prose judge; sc2 raised it again
      a1: 'fixed',
      d1: 'fixed',
      b2: 'open_at_end',
      p2: 'open_at_end',
      q2: 'open_at_end',
    });
  });

  it('recovers rounds and the confirmation from the scorecard ids; a quarantined version is no later reading', () => {
    const project = '0190aaaa-0000-7000-8000-000000000001';
    const id = (version: string, round: number, full = false) =>
      uuidFromKey(
        `chapter:${project}:2|${version}|scorecard${full ? ':full' : ''}|${String(round)}`,
      );
    const w1 = text('echo five', 'foxtrot six');
    const w2 = text('echo five', 'foxtrot six', 'golf seven');
    const w3 = text('echo five', 'hotel eight');
    const w4 = text('echo five', 'foxtrot six', 'golf seven', 'india nine');
    const leak = { source: 'judge:knowledge_leak_checker', kind: 'knowledge_leak' };
    const rows = traceFindings({
      projectId: project,
      chapters: [
        {
          number: 2,
          versions: [
            { id: 'w1', version_no: 1, text: w1, quarantined: false },
            { id: 'w2', version_no: 2, text: w2, quarantined: false },
            { id: 'w3', version_no: 3, text: w3, quarantined: true },
            { id: 'w4', version_no: 4, text: w4, quarantined: false },
          ],
          scorecards: [
            {
              id: id('w1', 0),
              manuscript_version_id: 'w1',
              issues: [
                at(w1, 'echo five', { id: 'e0' }),
                at(w1, 'foxtrot six', { id: 'k0', ...leak }),
              ],
            },
            { id: id('w2', 1), manuscript_version_id: 'w2', issues: [] },
            {
              id: id('w3', 2),
              manuscript_version_id: 'w3',
              issues: [at(w3, 'echo five', { id: 'e2' })],
            },
            {
              id: id('w4', 3),
              manuscript_version_id: 'w4',
              sections: { prose: { carried_from: id('w3', 2) } },
              issues: [at(w4, 'foxtrot six', { id: 'k3', ...leak })],
            },
            { id: id('w4', 3, true), manuscript_version_id: 'w4', key: 'w4:full', issues: [] },
          ],
        },
      ],
    });
    const by = Object.fromEntries(rows.map((r) => [r.issue_id ?? '', r] as const));
    expect(rows.map((r) => [r.issue_id, r.round, r.round_from, r.reading])).toEqual([
      ['e0', 0, 'scorecard_id', 'full'],
      ['k0', 0, 'scorecard_id', 'full'],
      ['e2', 2, 'scorecard_id', 'full'],
      ['k3', 3, 'scorecard_id', 'targeted'],
    ]);
    // Only the quarantined w3 raised e0 again: fixed, not came_back.
    expect(by.e0?.later).toBe('fixed');
    // Absent in w2, raised again in w4, absent from the confirmation.
    expect(by.k0?.later).toBe('came_back');
    expect(by.e2).toMatchObject({
      quarantined: true,
      version_no: 3,
      span_state: 'passed_unchanged',
    });
    // The knowledge checker last read w3, which lacks the paragraph.
    expect(by.k3?.span_state).toBe('changed_since_last_reading');
    expect(
      roundFromScorecardId(project, 2, { id: id('w4', 3, true), manuscript_version_id: 'w4' }),
    ).toEqual({
      round: 3,
      confirmation: true,
    });
    expect(
      roundFromScorecardId(project, 3, { id: id('w4', 3), manuscript_version_id: 'w4' }),
    ).toBeUndefined();
  });

  it('marks demoted findings, and findings a second reading kept', () => {
    const x1 = text('juliet ten', 'kilo eleven');
    const card = (calls: string[]): TraceScorecard => ({
      id: 'c0',
      manuscript_version_id: 'x1',
      evaluator_calls: calls,
      issues: [
        at(x1, 'juliet ten', { id: 'kept-by-note' }),
        at(x1, 'kilo eleven', { id: 'doubt', severity: 'minor', claim: `${DOUBT}synthetic claim` }),
        spanless('weak_pacing', {
          id: 'not-major',
          severity: 'minor',
          claim: `${NOT_MAJOR}${'c'.repeat(120)}`,
        }),
        at(x1, 'kilo eleven', {
          id: 'kept-by-call',
          source: 'judge:structure_judge',
          kind: 'weak_hook',
        }),
        at(x1, 'juliet ten', { id: 'single', source: 'judge:voice_judge', kind: 'voice_drift' }),
        at(x1, 'juliet ten', { id: 'minor', source: 'judge:voice_judge', severity: 'minor' }),
      ],
    });
    const trace = (calls: string[], secondReadings?: Map<string, string>) =>
      Object.fromEntries(
        traceFindings({
          chapters: [
            {
              number: 3,
              versions: [{ id: 'x1', version_no: 1, text: x1, quarantined: false }],
              scorecards: [card(calls)],
            },
          ],
          ...(secondReadings ? { secondReadings } : {}),
        }).map((r) => [r.issue_id ?? '', r] as const),
      );
    const rows = trace(['call-1', 'call-2'], new Map([['call-2', 'structure_judge']]));
    expect(Object.keys(rows)).toEqual([
      'kept-by-note',
      'doubt',
      'not-major',
      'kept-by-call',
      'single',
    ]);
    expect(rows.doubt).toMatchObject({
      severity: 'minor',
      reproduced: 'dropped_by_second_reading',
    });
    expect(rows['not-major']?.reproduced).toBe('dropped_by_second_reading');
    expect(Array.from(rows['not-major']?.claim ?? '')).toHaveLength(100);
    expect(rows['kept-by-note']?.reproduced).toBe('kept');
    expect(rows['kept-by-call']?.reproduced).toBe('kept');
    expect(rows.single?.reproduced).toBe('single_reading');
    // Without the `:agree` call the structure judge's finding shows a single reading.
    expect(trace(['call-1', 'call-2'])['kept-by-call']?.reproduced).toBe('single_reading');
  });

  it('marks the consensus demotion and the ledger hold of standard@34 (ADR-0115)', () => {
    const y1 = text('lima twelve', 'mike thirteen');
    const rows = traceFindings({
      chapters: [
        {
          number: 4,
          versions: [{ id: 'y1', version_no: 1, text: y1, quarantined: false }],
          scorecards: [
            {
              id: 'c0',
              manuscript_version_id: 'y1',
              issues: [
                at(y1, 'lima twelve', {
                  id: 'quorum',
                  severity: 'minor',
                  claim: '(3회 판독 중 1회만 주요 결함으로 지적) synthetic claim',
                }),
                at(y1, 'mike thirteen', {
                  id: 'held',
                  severity: 'minor',
                  claim:
                    '(앞서 통과한 대목의 새 지적: 최종 전체 판독의 합의를 거쳐야 한다) synthetic claim',
                }),
              ],
            },
          ],
        },
      ],
    });
    expect(rows.map((r) => [r.issue_id, r.reproduced])).toEqual([
      ['quorum', 'dropped_by_second_reading'],
      ['held', 'held_by_ledger'],
    ]);
  });

  it('honours an explicit plan over the sections, and cuts the quote to 60 code points', () => {
    const long = 'ㄱ'.repeat(70);
    const y1 = text('lima twelve', long);
    const y2 = text('lima twelve', long, 'mike thirteen');
    const rows = traceFindings({
      chapters: [
        {
          number: 4,
          versions: [
            { id: 'y1', version_no: 1, text: y1, quarantined: false },
            { id: 'y2', version_no: 2, text: y2, quarantined: false },
          ],
          scorecards: [
            { id: 'd0', manuscript_version_id: 'y1', issues: [at(y1, long, { id: 'long' })] },
            {
              id: 'd1',
              manuscript_version_id: 'y2',
              mode: 'targeted',
              rerun: ['continuity_checker'],
              issues: [at(y2, long, { id: 'again' }), spanless('weak_pacing', { id: 'carried' })],
            },
          ],
        },
      ],
    });
    expect(rows.map((r) => [r.issue_id, r.reading, r.span_state])).toEqual([
      ['long', 'full', 'first_reading'],
      ['again', 'targeted', 're_raised'],
    ]);
    expect(Array.from(rows[0]?.quote ?? '')).toHaveLength(60);
  });

  it('renders one table per chapter and the span state × reading summary', () => {
    const md = renderFindingTrace(traceFindings({ chapters: [chapter] }));
    expect(md).toContain('# Finding trace — 7 findings in 1 chapters');
    expect(md).toContain('## Chapter 1');
    expect(md).toContain(
      '| # | round | version | reading | source | severity | kind | span | second reading | later | quote | claim |',
    );
    expect(md).toContain(
      '| 2 | r1? | v2 | confirmation | judge:continuity_checker | major | timeline_error | passed_unchanged | single_reading | open_at_end | bravo two | synthetic claim |',
    );
    expect(md).toContain('| first_reading | 2 | 0 | 0 | 2 |');
    expect(md).toContain('| re_raised | 0 | 1 | 1 | 2 |');
    expect(md).toContain('| passed_unchanged | 0 | 0 | 1 | 1 |');
    expect(md).toContain('| changed_since_last_reading | 0 | 1 | 0 | 1 |');
    expect(md).toContain('| no_quote | 0 | 0 | 1 | 1 |');
    expect(md).toContain('| total | 2 | 2 | 3 | 7 |');
    expect(md).toContain(
      'Confirmation-reading findings on text that passed unchanged: 1 of 3; still blocking or major after any second reading: 1 of 3.',
    );
  });
});
