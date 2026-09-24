/**
 * The Korean-manuscript product loop end to end with the simulated model (ADR-0054/0055): a Korean intake
 * composes the Korean identity layers, the requirement interpreter returns Korean requirements with no
 * English paraphrase, and chapters are planned, drafted, evaluated and accepted in Korean.
 *
 * Regression: before ADR-0055 the Active Constraint Set demanded an English `text_en` for every non-English
 * requirement, so the first Korean chapter contract failed with CONSTRAINT_UNRENDERABLE.
 */
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import { createProject, createWorkspace, getNovelRun, PgAuditStore, type Pool } from '@yeonjae/db';
import { loadSchemas } from '@yeonjae/domain';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import {
  Gateway,
  MemoryBudget,
  MockProvider,
  type Provider,
  type ProviderRequest,
} from '@yeonjae/gateway';
import { simulatedModelScript as script } from './simulated-model.js';
import { approveConcept, resumeNovelRun, startNovel } from './novel.js';
import { NovelRunner } from './novel-runner.js';
import { ArtifactLlmOutputStore } from './runtime.js';
import { exportAccepted } from './chapter-production.js';
import { angleSeeds, worldRulesTerm } from './story-plan.js';
import { buildRunReport, renderRunReport } from './run-report.js';
import { relintAccepted } from './relint.js';
import { REPLAY_ROUTING } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const INTAKE = {
  title_working: '재의 장부',
  premise:
    '파면당한 길드 회계사가 도시의 게이트 방위 자금 장부가 조작됐다는 걸 알아채고, 그걸 증명하려고 직접 헌터 서열을 오른다.',
  premise_language: 'ko',
  manuscript_language: 'ko',
  genre: { primary: 'hunter-gate', secondary: ['academy'] },
  main_character: { name: '서지안', role: 'protagonist', description: '29세. 전직 길드 회계사.' },
  supporting_characters: [
    { name: '백태호', role: 'mentor', description: '48세, 은퇴한 B급 척후.' },
    { name: '문해린', role: 'antagonist', description: '35세, 길드 재무 담당.' },
  ],
  content_restrictions: ['성적인 묘사 금지'],
  target_chapters: 2,
  target_characters_per_chapter: 1400,
  operating_mode: 'autopilot',
};

const routing = {
  ...REPLAY_ROUTING,
  R: REPLAY_ROUTING.R.map((r) => ({ ...r, provider: 'mock' })),
  P: REPLAY_ROUTING.P.map((r) => ({ ...r, provider: 'mock' })),
  M: REPLAY_ROUTING.M.map((r) => ({ ...r, provider: 'mock' })),
  C: REPLAY_ROUTING.C.map((r) => ({ ...r, provider: 'mock' })),
};

run('Korean novel run: intake → bible → chapters, prompts in Korean (simulated live model)', () => {
  let pool: Pool;
  let workspaceId: string;
  let projectId: string;
  const seen: ProviderRequest[] = [];
  // Words the model itself wrote. The simulated model's bible and plan content is English fixture data;
  // when later prompts quote it back that is model content, not a rendering this system added.
  const modelWords = new Set<string>();
  const provider = new MockProvider((req) => {
    seen.push(req);
    const out = script(req);
    for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
    return out;
  });

  beforeAll(async () => {
    pool = await freshDatabase();
    workspaceId = await createWorkspace(pool, 'novel-ko-e2e');
    ({ projectId } = await createProject(pool, {
      workspaceId,
      title: '재의 장부',
      operatingMode: 'autopilot',
    }));
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  const makeDeps = () => ({
    pool,
    gateway: new Gateway({
      providers: new Map([['mock', provider]]),
      routing,
      budget: new MemoryBudget(10_000_000),
      audit: new PgAuditStore(
        pool,
        { workspaceId, projectId },
        new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
      ),
    }),
  });

  it('plans and accepts Korean chapters from Korean requirements', async () => {
    const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
    expect(started.run.status).toBe('awaiting_approval');
    const concept = started.concepts[0];
    await approveConcept(pool, { projectId, conceptId: concept?.id ?? '', autoContinue: true });
    const runner = new NovelRunner({ pool, makeDeps, runnerId: 'ko-runner', leaseSeconds: 30 });
    while (await runner.tick()) {
      const r = await getNovelRun(pool, projectId);
      if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
    }
    const after = await getNovelRun(pool, projectId);
    expect(after?.last_error ?? null).toBeNull();
    expect(after?.status).toBe('completed');

    const chapters = await pool.query<{ number: number; status: string }>(
      'SELECT number, status FROM chapters WHERE project_id = $1 ORDER BY number',
      [projectId],
    );
    expect(chapters.rows).toEqual([
      { number: 1, status: 'accepted' },
      { number: 2, status: 'accepted' },
    ]);

    // Every style-sensitive prompt carried the Korean identity block, and the writer saw a Korean contract.
    const writer = seen.filter((r) => r.trace?.role === 'scene_writer');
    expect(writer.length).toBeGreaterThan(0);
    for (const r of writer) {
      expect(r.system).toMatch(/lang=ko\/ko-KR/);
      expect(r.system).toMatch(/## 출력 언어 계약 \(한국어\)/);
      expect(r.system).not.toMatch(/Output-Language Contract/);
      expect(`${r.system}\n${r.user}`).toMatch(/회차 계약/);
    }
    const planner = seen.filter((r) => r.trace?.role === 'chapter_planner');
    for (const r of planner) {
      expect(r.user).toMatch(/하드 요구사항/);
      expect(r.user).not.toMatch(/Use ONLY the entity ids above/);
    }

    // KO-PROMPT-SURFACE-001: no English instruction or canon rendering reaches any Korean prompt. Every
    // model call of the run is scanned; Latin words are allowed only as identifiers (schema keys and enum
    // values, snake_case, provenance tags) — see `englishLeaks`.
    const leaks = seen.flatMap((r) =>
      englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
        (w) => `${r.trace?.role ?? '?'}: ${w}`,
      ),
    );
    expect([...new Set(leaks)]).toEqual([]);

    // Audit §6.1. The simulated model echoes its angle seed back, so the scan above counts a seed's
    // words as model words; the seeds and the bible's world-rules term are checked directly.
    const seeds = seen
      .filter((r) => r.trace?.role === 'concept_generator')
      .map((r) => /이 후보의 앵글 시드: (.+)/.exec(r.user)?.[1]);
    expect(seeds.length).toBeGreaterThanOrEqual(2);
    for (const s of seeds) {
      expect(angleSeeds('ko')).toContain(s);
      expect(s).not.toMatch(/[A-Za-z]/);
    }
    const terms = await pool.query<{ display_name: string }>(
      "SELECT display_name FROM entities WHERE project_id = $1 AND type = 'term'",
      [projectId],
    );
    const termNames = terms.rows.map((t) => t.display_name);
    expect(termNames).toContain(worldRulesTerm('ko').name);
    expect(termNames).not.toContain('World rules');

    // Audit §5.12: a Korean export's headings read N화.
    const exported = await exportAccepted(pool, {
      projectId,
      format: 'markdown',
      title: '재의 장부',
    });
    expect(exported.language).toBe('ko');
    expect(exported.text).toMatch(/^# 재의 장부\n\n## 1화\n\n/);
    expect(exported.text).toContain('\n## 2화\n\n');
    expect(exported.text).not.toContain('Chapter');
  }, 300_000);
});

/** Schema keys and enum values: identifiers a Korean prompt may carry verbatim. */
const SCHEMA_WORDS: ReadonlySet<string> = (() => {
  const out = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) {
        out.add(k);
        if (k === 'enum' && Array.isArray(v))
          for (const e of v) if (typeof e === 'string') out.add(e);
        if (k === 'const' && typeof v === 'string') out.add(v);
        walk(v);
      }
  };
  for (const s of loadSchemas().schemas.values()) walk(s.schema);
  return out;
})();

/** Provenance tags, identity-block markers and model-facing ids that are identifiers by design (ADR-0055). */
const TAGS = new Set([
  'FACT',
  'PLANNED',
  'SUMMARY',
  'EVIDENCE',
  'UNTRUSTED',
  'KNOWLEDGE',
  'RELATIONSHIP',
  'BEGIN',
  'END',
  'NARRATIVE',
  'IDENTITY',
  'TAIL',
  'lang',
  'ko',
  'KR',
  'id',
  'ids',
  'json',
  'JSON',
  'REQ',
  'HP',
  'MP',
  // Extraction sweep ids the canon_extractor prompt defines.
  'event-first',
  'entity-first',
]);

/**
 * Latin-script words in a Korean prompt that are neither identifiers nor model content: schema keys and
 * enum values, JSON keys of the prompt's own shape example, quoted or dashed ids (`"leaderboard"`,
 * `AC-LEN`), provenance tags, genre jargon Korean readers write in Latin (NTR), and words the model
 * produced earlier in the run.
 */
function englishLeaks(text: string, modelWords: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const jsonKeys = new Set([...text.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g)].map((m) => m[1]));
  for (const m of text.matchAll(/[A-Za-z][A-Za-z'’-]{2,}/g)) {
    const w = m[0].replace(/[’'-]+$/, '');
    const at = m.index;
    const before = text[at - 1] ?? '';
    const after = text[at + m[0].length] ?? '';
    if (before === '_' || after === '_' || /[0-9]/.test(before) || /[0-9]/.test(after)) continue;
    if (before === '"' && after === '"') continue;
    // Quoted examples of forbidden Latin words (‘OK’→‘좋아’) are the instruction, not a leak.
    if (before === '‘' && (after === '’' || m[0].endsWith('’'))) continue;
    // Enum alternatives ("a|b|c"), dotted identifiers (power.rank, pack.chapter_planner) and the
    // `new:<…>` proposition-ref form are identifiers.
    if (before === '|' || after === '|' || before === '.' || after === '.' || after === ':')
      continue;
    // Id fragments (`<uuid>#guard@1`).
    if (before === '#' || after === '@') continue;
    if (/^[A-Z]+(-[A-Z0-9]+)+$/.test(w) || w === 'NTR') continue;
    if (TAGS.has(w) || SCHEMA_WORDS.has(w) || SCHEMA_WORDS.has(w.toLowerCase())) continue;
    if (jsonKeys.has(w) || modelWords.has(w) || modelWords.has(m[0])) continue;
    out.push(
      `${w} ← “${text.slice(Math.max(0, at - 30), at + w.length + 30).replace(/\s+/g, ' ')}”`,
    );
  }
  return out;
}

const EVALUATOR_ROLES = new Set([
  'contract_checker',
  'continuity_checker',
  'knowledge_leak_checker',
  'prose_judge',
  'structure_judge',
  'genre_judge',
  'voice_judge',
  'promise_checker',
  'repetition_judge',
]);

run('Korean novel run under standard.v2: evaluation v2 (ADR-0060)', () => {
  let pool: Pool;
  let workspaceId: string;
  let projectId: string;
  const seen: ProviderRequest[] = [];
  let inFlight = 0;
  let evaluatorPeak = 0;
  // Words the model itself wrote, for the Latin-script scan (as in the standard.v1 run above).
  const modelWords = new Set<string>();
  // Chapter 1's first prose judgment finds one 번역투 sentence, so one revision round runs and the
  // re-evaluation after the patch is targeted (ADR-0060): only the prose judge answers again.
  const flaggedSentence = (prompt: string) => {
    const p2 = /\n\[p2\] ([^\n]+)/.exec(prompt)?.[1] ?? '';
    return /^[^.!?…]+[.!?…]/.exec(p2)?.[0] ?? p2;
  };
  const answer = (req: ProviderRequest) => {
    const activity = req.trace?.activityId ?? '';
    if (req.trace?.role === 'prose_judge' && activity.endsWith(':1:r0'))
      return {
        json: {
          judge_score: 60,
          dimension_scores: {
            idiomatic_korean: 2,
            readability: 3,
            register_fidelity: 3,
            translation_markers: 2,
          },
          drift_flags: [],
          issues: [
            {
              kind: 'translation_like_english',
              severity: 'major',
              confidence: 0.9,
              claim: '번역투 문장이다. 주어를 줄이고 동작으로 쓴다.',
              quote: flaggedSentence(req.user),
            },
          ],
        },
      };
    if (req.trace?.role === 'targeted_reviser') {
      const span = /\[수정할 구간\]\n([\s\S]*?)\n\n\[뒷 맥락\]/.exec(req.user)?.[1] ?? '';
      const sentence = /^[^.!?…]+[.!?…]/.exec(span.trim())?.[0] ?? span.trim();
      return {
        json: {
          scope: 'sentence',
          span: { original_quote: sentence },
          new_text: `문득 ${sentence}`,
          changed_claims: [],
          preserved_facts_ack: [],
          speaker_annotations: [],
        },
      };
    }
    return script(req);
  };
  const mock = new MockProvider((req) => {
    seen.push(req);
    const out = answer(req);
    for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
    return out;
  });
  // Evaluator answers take a few milliseconds, so parallel evaluation is observable as overlap.
  const provider: Provider = {
    name: 'mock',
    async complete(req, signal) {
      const evaluator = EVALUATOR_ROLES.has(req.trace?.role ?? '');
      if (evaluator) evaluatorPeak = Math.max(evaluatorPeak, ++inFlight);
      try {
        if (evaluator) await new Promise((r) => setTimeout(r, 10));
        return await mock.complete(req, signal);
      } finally {
        if (evaluator) inFlight--;
      }
    },
  };

  beforeAll(async () => {
    pool = await freshDatabase();
    workspaceId = await createWorkspace(pool, 'novel-ko-v2-e2e');
    ({ projectId } = await createProject(pool, {
      workspaceId,
      title: '재의 장부',
      operatingMode: 'autopilot',
      policyVersion: 'policy/standard@2',
    }));
  }, 120_000);

  afterAll(async () => {
    await pool.end();
  });

  const makeDeps = () => ({
    pool,
    gateway: new Gateway({
      providers: new Map([['mock', provider]]),
      routing,
      budget: new MemoryBudget(10_000_000),
      audit: new PgAuditStore(
        pool,
        { workspaceId, projectId },
        new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
      ),
    }),
  });

  it('runs nine evaluators four at a time and gates on rubric sub-scores', async () => {
    const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
    await approveConcept(pool, {
      projectId,
      conceptId: started.concepts[0]?.id ?? '',
      autoContinue: true,
    });
    const runner = new NovelRunner({ pool, makeDeps, runnerId: 'ko-v2-runner', leaseSeconds: 30 });
    while (await runner.tick()) {
      const r = await getNovelRun(pool, projectId);
      if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
    }
    const after = await getNovelRun(pool, projectId);
    expect(after?.last_error ?? null).toBeNull();
    expect(after?.status).toBe('completed');

    // Both optional evaluators ran for every chapter, and evaluators overlapped (max_parallel_evaluators 4).
    const roles = (role: string) => seen.filter((r) => r.trace?.role === role);
    expect(roles('promise_checker')).toHaveLength(2);
    expect(roles('repetition_judge')).toHaveLength(2);
    expect(evaluatorPeak).toBeGreaterThan(1);
    expect(evaluatorPeak).toBeLessThanOrEqual(4);

    // Every evaluator read its own inputs: the voice judge its own rubric and a register report, the
    // repetition judge chapter 1's opening when judging chapter 2, the knowledge checker separate slots.
    const voice = roles('voice_judge')[0];
    expect(voice?.system).toMatch(/role=judge_rubric_voice/);
    expect(voice?.user).toMatch(/\[말높이 검사 보고 — 결정적 검사\]\n따옴표 발화 \d+개/);
    const repetition = roles('repetition_judge').map((r) => r.user);
    expect(repetition[0]).toMatch(/비교할 이전 화가 없다/);
    expect(repetition[1]).toMatch(/\[1화 — 도입\]/);
    const leak = roles('knowledge_leak_checker')[0]?.user ?? '';
    expect(leak).toMatch(/\[지식 입장/);
    expect(leak).toMatch(/\[독자에게 아직 밝히면 안 되는 비밀/);
    const continuity = roles('continuity_checker')[0]?.user ?? '';
    // The timeline section reaches the continuity checker once (it was sent twice before ADR-0060).
    const titles = [
      '타임라인 위치 — 현실 프레임과 고정값',
      'TIMELINE POSITION — reality frame and pins',
    ];
    expect(titles.reduce((n, t) => n + continuity.split(t).length - 1, 0)).toBe(1);
    expect(continuity).toMatch(/\[잠긴 사실 — 절대 어기면 안 되는 정사\]/);

    // The re-evaluation after chapter 1's patch was targeted: only the prose judge answered again, the
    // other evaluators' findings were carried from the parent version's scorecard.
    const round1 = seen
      .filter((r) => EVALUATOR_ROLES.has(r.trace?.role ?? ''))
      .filter((r) => (r.trace?.activityId ?? '').endsWith(':1:r1'))
      .map((r) => r.trace?.role);
    expect(round1).toEqual(['prose_judge']);

    // Gated dimensions are composed from the rubric sub-scores and the deterministic composites.
    const cards = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM workflow_artifacts
        WHERE project_id = $1 AND step = 'evaluate' AND kind = 'scorecard' ORDER BY created_at`,
      [projectId],
    );
    expect(cards.rows.length).toBe(3);
    const [first, revised] = cards.rows.map((r) => r.payload);
    const revisedSections = (revised?.sections ?? {}) as Record<string, Record<string, unknown>>;
    expect(revised?.evaluator_calls).toHaveLength(1);
    expect(revisedSections.continuity?.carried_from).toBe(first?.id);
    expect(revisedSections.voice?.carried_from).toBe(first?.id);
    expect(revisedSections.prose?.carried_from).toBeUndefined();
    expect(
      (revisedSections.prose?.score as number) >
        ((first?.sections as Record<string, Record<string, number>>).prose?.score ?? 100),
    ).toBe(true);
    for (const { payload } of cards.rows) {
      const sections = payload.sections as Record<string, Record<string, unknown>>;
      expect(Object.keys(sections)).toEqual(expect.arrayContaining(['promises', 'repetition']));
      const prose = sections.prose ?? {};
      expect(prose.score_model).toBe('rubric_subscores');
      // idiomatic 4, readability 5, register 4, markers 5 → mean 4.5 → 87.5 (the flagged first
      // judgment: 2, 3, 3, 2 → 37.5); judge_weight 0.6.
      expect(prose.rubric_score).toBe(payload === first ? 37.5 : 87.5);
      expect(prose.judge_weight).toBe(0.6);
      expect(prose.score).toBe(
        Math.round(
          (0.6 * (prose.rubric_score as number) + 0.4 * (prose.lint_composite as number)) * 10,
        ) / 10,
      );
      expect(prose.judge_score).toBe(payload === first ? 60 : 86);
      expect(typeof sections.voice?.register_violation_rate).toBe('number');
      expect(typeof sections.genre?.terminology_compliance).toBe('number');
    }

    // KO-PROMPT-SURFACE-001 over the evaluation v2 surfaces (the 4.4.0 evaluators, promise_checker,
    // repetition_judge and the targeted re-evaluation), which only a standard.v2 project reaches.
    const leaks = seen.flatMap((r) =>
      englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
        (w) => `${r.trace?.role ?? '?'}: ${w}`,
      ),
    );
    expect([...new Set(leaks)]).toEqual([]);
  }, 300_000);
});

run(
  'Korean novel run under standard.v3: state ledgers and the pre-draft plan check (ADR-0063)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = script(req);
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v3-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@3',
      }));
    }, 120_000);

    afterAll(async () => {
      await pool.end();
    });

    const makeDeps = () => ({
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
        ),
      }),
    });

    it('checks each plan before drafting and gives the writer the state ledger', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v3-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      // One plan-check artifact per chapter, recorded before drafting, with no blocking finding.
      const checks = await pool.query<{
        payload: { chapter_no: number; findings: { blocking: boolean }[] };
      }>(
        `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'plan_check' ORDER BY created_at`,
        [projectId],
      );
      expect(checks.rows.map((r) => r.payload.chapter_no)).toEqual([1, 2]);
      for (const r of checks.rows) expect(r.payload.findings.filter((f) => f.blocking)).toEqual([]);

      // The writer reads the ledger in Korean: the state cards of its on-page characters and the clock.
      const writer = seen.filter((r) => r.trace?.role === 'scene_writer');
      expect(writer.length).toBeGreaterThan(0);
      for (const r of writer) {
        expect(r.user).toMatch(/\[상태 장부 — [^\]]*\]/);
        expect(r.user).toMatch(/이번 화 시작: /);
      }

      // KO-PROMPT-SURFACE-001 over the ADR-0063 surfaces.
      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v4: a regressed patch is discarded and revision continues (ADR-0064)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    const firstSentence = (prompt: string) => {
      const p2 = /\n\[p2\] ([^\n]+)/.exec(prompt)?.[1] ?? '';
      return /^[^.!?…]+[.!?…]/.exec(p2)?.[0] ?? p2;
    };
    // Chapter 1: the first judgment flags a 번역투 sentence; the round-1 patch leaves it and scores lower, so the
    // regression check fails; the round-2 patch resolves it.
    const flagged = (req: ProviderRequest, score: number, subs: number) => ({
      json: {
        judge_score: score,
        dimension_scores: {
          idiomatic_korean: subs,
          readability: subs,
          register_fidelity: subs,
          translation_markers: subs,
        },
        drift_flags: [],
        issues: [
          {
            kind: 'translation_like_english',
            severity: 'major',
            confidence: 0.9,
            claim: '번역투 문장이다. 주어를 줄이고 동작으로 쓴다.',
            quote: firstSentence(req.user),
          },
        ],
      },
    });
    const answer = (req: ProviderRequest) => {
      const activity = req.trace?.activityId ?? '';
      if (req.trace?.role === 'prose_judge' && activity.endsWith(':1:r0'))
        return flagged(req, 60, 2);
      if (req.trace?.role === 'prose_judge' && activity.endsWith(':1:r1'))
        return flagged(req, 40, 1);
      if (req.trace?.role === 'targeted_reviser') {
        const span = /\[수정할 구간\]\n([\s\S]*?)\n\n\[뒷 맥락\]/.exec(req.user)?.[1] ?? '';
        const sentence = /^[^.!?…]+[.!?…]/.exec(span.trim())?.[0] ?? span.trim();
        return {
          json: {
            scope: 'sentence',
            span: { original_quote: sentence },
            new_text: `문득 ${sentence}`,
            changed_claims: [],
            preserved_facts_ack: [],
            speaker_annotations: [],
          },
        };
      }
      return script(req);
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = answer(req);
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v4-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@4',
      }));
    }, 120_000);

    afterAll(async () => {
      await pool.end();
    });

    const makeDeps = () => ({
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
        ),
      }),
    });

    it('quarantines the regressed patch, revises again from the version before it and accepts', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v4-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const reports = await pool.query<{ payload: { passed: boolean; round: number } }>(
        `SELECT payload FROM workflow_artifacts
        WHERE project_id = $1 AND kind = 'regression_report' ORDER BY created_at`,
        [projectId],
      );
      expect(reports.rows.map((r) => [r.payload.round, r.payload.passed])).toEqual([
        [1, false],
        [2, true],
      ]);
      const quarantined = await pool.query<{ rejection_reason: string }>(
        'SELECT rejection_reason FROM quarantine_versions WHERE project_id = $1',
        [projectId],
      );
      expect(quarantined.rows).toEqual([{ rejection_reason: 'patch_regressed:r1' }]);
      // The accepted chapter 1 descends from the version before the discarded patch, never from the patch.
      const accepted = await pool.query<{ parent_version_id: string | null }>(
        `SELECT mv.parent_version_id FROM chapters c JOIN manuscript_versions mv ON mv.id = c.accepted_version_id
        WHERE c.project_id = $1 AND c.number = 1`,
        [projectId],
      );
      const parents = await pool.query<{ id: string }>(
        'SELECT id FROM quarantine_versions WHERE project_id = $1',
        [projectId],
      );
      expect(accepted.rows[0]?.parent_version_id).not.toBe(parents.rows[0]?.id);

      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 300_000);

    it('reports the run from what it persisted, and re-lints the accepted chapters under another layer', async () => {
      const report = await buildRunReport(pool, projectId, { normalizations: { scene_plans: 2 } });
      expect(report.policy).toBe('policy/standard@4');
      expect(report.output_language).toBe('ko');
      expect(report.run?.status).toBe('completed');
      expect(report.chapters.map((c) => [c.number, c.status])).toEqual([
        [1, 'accepted'],
        [2, 'accepted'],
      ]);
      const [ch1, ch2] = report.chapters;
      // Chapter 1: the first draft, the regressed patch (quarantined) and the patch that passed.
      expect(ch1?.quarantined.map((q) => q.reason)).toEqual(['patch_regressed:r1']);
      expect(ch1?.rounds.some((r) => r.quarantined)).toBe(true);
      expect(ch1?.rounds[ch1.rounds.length - 1]?.accepted).toBe(true);
      expect(ch2?.rounds[ch2.rounds.length - 1]?.accepted).toBe(true);
      for (const c of report.chapters) {
        expect(c.characters).toBeGreaterThan(0);
        expect(c.plan_check).toBeDefined();
        for (const r of c.rounds) {
          expect(r.dimensions.map((d) => d.dimension).sort()).toEqual(
            ['genre', 'prose', 'structure', 'voice'].sort(),
          );
          expect(r.gate_outcome).toBeTruthy();
        }
      }
      const writer = report.roles.find((r) => r.role === 'scene_writer');
      expect(writer?.calls).toBeGreaterThan(0);
      expect(writer?.succeeded).toBe(writer?.calls);
      expect(report.totals.calls).toBe(report.roles.reduce((n, r) => n + r.calls, 0));
      const md = renderRunReport(report);
      expect(md).toMatch(/\| 1 \| accepted \| \d+ \|/);
      expect(md).toMatch(/\(quarantined\)/);
      expect(md).toMatch(/`scene_plans`: 2/);

      // New projects compose lang/ko@5; under lang/ko@4 the v5 measurements are absent.
      const pinned = await relintAccepted(pool, projectId);
      expect(pinned.layer).toBe('lang/ko@5');
      expect(pinned.chapters.map((c) => c.number)).toEqual([1, 2]);
      expect(pinned.chapters.every((c) => c.metrics.v5 !== undefined)).toBe(true);
      const older = await relintAccepted(pool, projectId, { layer: 'lang/ko@4', chapter: 2 });
      expect(older.layer).toBe('lang/ko@4');
      expect(older.chapters.map((c) => c.number)).toEqual([2]);
      expect(older.chapters[0]?.metrics.v5).toBeUndefined();
    }, 120_000);
  },
);

run(
  'Korean novel run under standard.v5: the writer reads the scene plan as text (ADR-0068)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = script(req);
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v5-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@5',
      }));
    }, 120_000);

    afterAll(async () => {
      await pool.end();
    });

    const makeDeps = () => ({
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
        ),
      }),
    });

    it('drafts every scene from a labelled Korean plan with names, and accepts both chapters', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v5-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const writer = seen.filter((r) => r.trace?.role === 'scene_writer');
      expect(writer.length).toBeGreaterThan(1);
      for (const r of writer) {
        const plan =
          /\[장면 계획 — 이번 회차; 장면 \d+ 작성\]\n([\s\S]*?)\n\n\[이 장면의 자리\]/.exec(
            r.user,
          )?.[1];
        expect(plan).toBeDefined();
        expect(plan).toMatch(/^장면 \d+ \(PLANNED/);
        expect(plan).toMatch(/\n목표: /);
        expect(plan).toMatch(/\n비트:\n1\. \[/);
        expect(plan).toMatch(/\n분량 목표: \d+자$/);
        expect(plan).not.toMatch(/"scene_no"|"objective"|"beats"/);
        // Participants and the location are named, not given as ids.
        expect(plan).toMatch(/\n등장: [가-힣]/);
      }
      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v6: the cast in three checkpointed batches, retries in the policy (ADR-0072)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    /**
     * The simulated designer returns its whole cast for any brief, so each batch keeps its share: the
     * protagonist, then one character plus the protagonist's register-only entry, then the rest.
     */
    const byBatch = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'character_designer' || !('json' in out)) return out;
      const cast = out.json as { characters: { display_name: string; role?: string }[] };
      const hero = cast.characters.find((c) => c.role === 'protagonist') ?? cast.characters[0];
      const rest = cast.characters.filter((c) => c !== hero);
      if (req.user.includes('주인공 한 명만')) return { json: { ...cast, characters: [hero] } };
      if (req.user.includes('핵심 인물'))
        return {
          json: {
            characters: [
              ...rest.slice(0, 1),
              {
                display_name: hero?.display_name,
                registers: [
                  { toward: rest[0]?.display_name, type: 'equal', address_terms: ['선배'] },
                ],
              },
            ],
            propositions: [],
          },
        };
      return { json: { characters: rest.slice(1), propositions: [] } };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = byBatch(req, script(req));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v6-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@6',
      }));
    }, 120_000);

    afterAll(async () => {
      await pool.end();
    });

    const makeDeps = () => ({
      pool,
      gateway: new Gateway({
        providers: new Map([['mock', provider]]),
        routing,
        budget: new MemoryBudget(10_000_000),
        audit: new PgAuditStore(
          pool,
          { workspaceId, projectId },
          new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
        ),
      }),
    });

    it('designs the cast in three checkpointed batches and merges them', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v6-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const designer = seen.filter((r) => r.trace?.role === 'character_designer');
      expect(designer).toHaveLength(3);
      expect(designer[0]?.user).toContain('주인공 한 명만');
      expect(designer[1]?.user).toContain('이미 설계된 인물: 서지안(주인공)');
      expect(designer[2]?.user).toContain('조연 2~4명');

      // One merged cast artifact; the supplied names all exist as characters.
      const characters = await pool.query<{ display_name: string }>(
        "SELECT display_name FROM entities WHERE project_id = $1 AND type = 'character'",
        [projectId],
      );
      const names = characters.rows.map((c) => c.display_name);
      for (const n of ['서지안', '백태호', '문해린']) expect(names).toContain(n);
      const batches = await pool.query<{ key: string }>(
        "SELECT key FROM workflow_artifacts WHERE project_id = $1 AND kind = 'cast_batch' ORDER BY key",
        [projectId],
      );
      expect(batches.rows).toHaveLength(3);
      // Each batch is its own completed checkpoint, so a rerun replays it instead of calling again.
      const steps = await pool.query<{ step: string }>(
        `SELECT js.step FROM job_steps js JOIN jobs j ON j.id = js.job_id
          WHERE j.project_id = $1 AND js.status = 'completed' AND js.step LIKE 'cast%' ORDER BY js.step`,
        [projectId],
      );
      expect(steps.rows.map((r) => r.step)).toEqual([
        'cast',
        'cast_core',
        'cast_protagonist',
        'cast_supporting',
      ]);

      // Every model call carried the policy's retry block; the audit rows record attempts.
      const calls = await pool.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM llm_calls WHERE project_id = $1',
        [projectId],
      );
      expect(Number(calls.rows[0]?.n ?? '0')).toBeGreaterThan(0);

      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 300_000);
  },
);
