/**
 * The Korean-manuscript product loop end to end with the simulated model (ADR-0054/0055): a Korean intake
 * composes the Korean identity layers, the requirement interpreter returns Korean requirements with no
 * English paraphrase, and chapters are planned, drafted, evaluated and accepted in Korean.
 *
 * Regression: before ADR-0055 the Active Constraint Set demanded an English `text_en` for every non-English
 * requirement, so the first Korean chapter contract failed with CONSTRAINT_UNRENDERABLE.
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import {
  acceptedArcSummariesBefore,
  createProject,
  createWorkspace,
  getNovelRun,
  insertArcSummaryOnce,
  PgAuditStore,
  type Pool,
} from '@yeonjae/db';
import { loadPolicies, loadSchemas, requirePolicy } from '@yeonjae/domain';
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
import { calibrateSceneTarget } from './length-calibration.js';
import { type ScenePlan } from './drafting.js';
import { measure, toNfcText } from '@yeonjae/prose';

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
      expect(md).toMatch(/\| 1 \| accepted \| \d+ \| \d+ \|/);
      // Both counts (ADR-0073, K3): with spaces, and without.
      const first = report.chapters[0];
      expect(first?.characters_no_spaces).toBeLessThan(first?.characters ?? 0);
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

/**
 * The simulated script for policies with batched cast design and a polish round: the cast batches split the
 * base script's cast, and the polish round's editor makes a one-word sentence edit.
 */
const batchedScript = (req: ProviderRequest, out: ReturnType<typeof script>) => {
  // The polish round's editor (the base script has no reviser): a one-word sentence edit.
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
  if (req.trace?.role !== 'character_designer' || !('json' in out)) return out;
  const cast = out.json as { characters: { display_name: string; role?: string }[] };
  const hero = cast.characters.find((c) => c.role === 'protagonist') ?? cast.characters[0];
  const rest = cast.characters.filter((c) => c !== hero);
  if (req.user.includes('주인공 한 명만')) return { json: { ...cast, characters: [hero] } };
  if (req.user.includes('핵심 인물'))
    return { json: { characters: rest.slice(0, 1), propositions: [] } };
  return { json: { characters: rest.slice(1), propositions: [] } };
};

run(
  'Korean novel run under standard.v7: lang/ko@6, point of view, style sample, contrast pairs, rhythm (ADR-0073)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = batchedScript(req, script(req));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    // Synthetic test strings (two short sentences at most), not manuscript prose.
    const intake = {
      ...INTAKE,
      // The simulated writer narrates in the third person; KO-POV-01 would (rightly) block a first-person
      // project on it.
      pov: 'third_limited',
      style_sample: '문이 열렸다. 나는 숨을 삼켰다.',
      contrast_pairs: [
        { translated: '그는 그녀에게 그것에 대해 말했다.', webnovel: '말했다. 짧게.' },
        { translated: '그녀는 미소를 지었다.', webnovel: '웃었다.' },
      ],
    };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v7-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@7',
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

    it('composes lang/ko@6 and carries the POV, sample, pairs and rhythm into the prompts', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v7-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const report = await buildRunReport(pool, projectId);
      expect(report.lineage.output_language).toBe('lang/ko@6');

      const writer = seen.filter((r) => r.trace?.role === 'scene_writer');
      expect(writer.length).toBeGreaterThan(1);
      for (const r of writer) {
        expect(r.system).toContain('## 시점 (절대)');
        expect(r.system).toContain('〔작가 문체 견본 — 최우선〕');
        expect(r.system).toContain('대조 예문');
      }
      const planner = seen.filter((r) => r.trace?.role === 'chapter_planner');
      for (const r of planner) expect(r.user).toContain('[연재 리듬 지시');
      const voice = seen.filter((r) => r.trace?.role === 'voice_judge');
      for (const r of voice) expect(r.system).toContain('## 시점 (절대)');

      const contracts = await pool.query<{ person: string }>(
        `SELECT payload->'pov'->>'person' AS person FROM workflow_artifacts
          WHERE project_id = $1 AND kind = 'chapter_contract'`,
        [projectId],
      );
      expect(contracts.rows.length).toBeGreaterThan(0);
      expect(new Set(contracts.rows.map((r) => r.person))).toEqual(new Set(['third_limited']));
      const rhythm = await pool.query<{ key: string }>(
        "SELECT key FROM workflow_artifacts WHERE project_id = $1 AND kind = 'rhythm_check' ORDER BY key",
        [projectId],
      );
      expect(rhythm.rows.map((r) => r.key)).toEqual(['1', '2']);
      // The polish round ran where the lint had findings, and its outcome is recorded either way.
      const polish = await pool.query<{ payload: { kept: boolean; lint_before: number } }>(
        "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'polish_report'",
        [projectId],
      );
      for (const p of polish.rows) expect(p.payload.lint_before).toBeGreaterThan(0);

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
  'Korean novel run under standard.v8: Korean pack budgets and scene length calibration (ADR-0075)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = batchedScript(req, script(req));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    // The simulated writer narrates in the third person (KO-POV-01 would block a first-person project).
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v8-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@8',
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

    it('asks each scene writer for the calibrated length; plans and packs keep the targets', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v8-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const cal = requirePolicy('policy/standard@8', loadPolicies()).length.scene_calibration;
      if (!cal) throw new Error('standard.v8 has no scene_calibration');
      const plans = await pool.query<{ key: string; payload: { scenes: ScenePlan[] } }>(
        "SELECT key, payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_plan'",
        [projectId],
      );
      const drafts = new Map(
        (
          await pool.query<{ key: string; text: string }>(
            `SELECT key, payload->>'text' AS text FROM workflow_artifacts
            WHERE project_id = $1 AND kind = 'scene_draft'`,
            [projectId],
          )
        ).rows.map((r) => [r.key, r.text]),
      );
      const firstAsk = new Map<string, string>();
      for (const r of seen) {
        const id = r.trace?.activityId ?? '';
        if (
          r.trace?.role === 'scene_writer' &&
          /^scene_draft:\d+:\d+$/.test(id) &&
          !firstAsk.has(id)
        )
          firstAsk.set(id, r.user);
      }
      let checked = 0;
      for (const plan of plans.rows) {
        const ch = plan.key.split(':')[0] ?? '';
        const targets = plan.payload.scenes.map((s) => s.length_target.value);
        // The stored plan keeps the planner's targets (700자 per simulated scene), not the requested length.
        expect(new Set(targets)).toEqual(new Set([700]));
        const measured: number[] = [];
        for (const [i, s] of plan.payload.scenes.entries()) {
          const expected = calibrateSceneTarget(targets, i, measured, cal).requested;
          if (i === 0) expect(expected).toBe(560);
          expect(firstAsk.get(`scene_draft:${ch}:${s.scene_no}`)).toContain(
            `목표 ${expected}자(공백 포함)`,
          );
          const text = drafts.get(`${ch}:${s.scene_no}`) ?? '';
          measured.push(measure(toNfcText(text)).characters);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(2);

      // Under the v8 budgets no Korean pack here needs a degradation-ladder step (the run has no vector or
      // lexical retriever, so `degraded` itself is set for that reason).
      const packs = await pool.query<{ template: string; steps: unknown[] }>(
        `SELECT template, manifest->'degradation'->'ladder_steps' AS steps FROM context_packs
        WHERE project_id = $1`,
        [projectId],
      );
      expect(packs.rows.length).toBeGreaterThan(0);
      expect(packs.rows.filter((p) => p.steps.length > 0)).toEqual([]);

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
  'Korean novel run under standard.v9: arc summaries for hierarchical story memory (ADR-0076)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    // Two one-chapter seasons, so chapter 2 opens a new arc and the first arc gets its summary.
    const twoArcs = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      const o = batchedScript(req, out);
      if (req.trace?.role !== 'story_architect' || !('json' in o)) return o;
      const bp = o.json as { seasons: Record<string, unknown>[] };
      const s = bp.seasons[0] ?? {};
      return {
        json: {
          ...bp,
          seasons: [
            { ...s, ordinal: 1, chapter_range_est: { from: 1, to: 1 } },
            { ...s, ordinal: 2, chapter_range_est: { from: 2, to: 2 } },
          ],
        },
      };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = twoArcs(req, script(req));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v9-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@9',
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

    it('summarizes a finished arc from its accepted L1 summaries and briefs the next arc with it', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v9-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const summarizer = seen.filter((r) => r.trace?.role === 'arc_summarizer');
      expect(summarizer).toHaveLength(1);
      expect(summarizer[0]?.trace?.activityId).toBe('arc_summary:1-1');
      expect(summarizer[0]?.user).toMatch(/\[회차 요약[^\n]*\]\n1화: /);

      const l2 = await acceptedArcSummariesBefore(pool, projectId, 3);
      expect(l2.map((r) => [r.chapter_from, r.chapter_to])).toEqual([[1, 1]]);
      expect(l2[0]?.text.startsWith('아크 요약: ')).toBe(true);
      // Not readable before the arc it covers has ended.
      expect(await acceptedArcSummariesBefore(pool, projectId, 1)).toEqual([]);
      const art = await pool.query<{ payload: { summary_id: string; truncated: boolean } }>(
        "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'arc_summary' AND key = '1-1'",
        [projectId],
      );
      expect(art.rows[0]?.payload.summary_id).toBe(l2[0]?.summary_id);
      expect(art.rows[0]?.payload.truncated).toBe(false);
      // The first stored summary of a range wins.
      const again = await insertArcSummaryOnce(pool, {
        workspaceId,
        projectId,
        chapterFrom: 1,
        chapterTo: 1,
        text: '다른 요약.',
        canonVersion: 0,
      });
      expect(again).toMatchObject({ created: false, summary_id: l2[0]?.summary_id });

      // The second arc's planner reads the first arc's summary in its brief.
      const planners = seen.filter((r) => r.trace?.role === 'arc_planner');
      expect(planners).toHaveLength(2);
      expect(planners[0]?.user).not.toContain('(지난 아크 요약');
      expect(planners[1]?.user).toContain('(지난 아크 요약, 승인된 원고 기준)');

      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 300_000);
  },
);

function multiPatchRun(title: string, breakSecondPatch: boolean) {
  run(title, () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    // Round 0's prose judge flags the first sentence of the first and of the last paragraph: two spans far
    // apart, so the revision round asks for two patches.
    const twoIssues = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      const o = batchedScript(req, out);
      if (
        req.trace?.role !== 'prose_judge' ||
        !req.trace.activityId.endsWith(':r0') ||
        !('json' in o)
      )
        return o;
      const text = /\[회차 원문[^\n]*\]\n([\s\S]*)/.exec(req.user)?.[1] ?? '';
      const paras = [...text.matchAll(/^\[p\d+\] (.+)$/gm)].map((m) => m[1] ?? '');
      const first = (p: string) => /^[^.!?…]+[.!?…]/.exec(p.trim())?.[0] ?? p.trim();
      const quotes = [first(paras[0] ?? ''), first(paras[paras.length - 1] ?? '')];
      return {
        json: {
          ...(o.json as Record<string, unknown>),
          issues: quotes.map((quote) => ({
            kind: 'translation_like_english',
            claim: '번역투 문장이다.',
            severity: 'major',
            confidence: 0.9,
            quote,
          })),
        },
      };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out =
        breakSecondPatch &&
        req.trace?.role === 'targeted_reviser' &&
        req.trace.activityId.endsWith(':p2')
          ? {
              json: {
                scope: 'sentence',
                span: { original_quote: '원고에 없는 문장이다.' },
                new_text: '다른 문장이다.',
                changed_claims: [],
                preserved_facts_ack: [],
                speaker_annotations: [],
              },
            }
          : twoIssues(req, script(req));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v10-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@10',
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

    it('asks for one patch per span cluster and applies them as one revision', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v10-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const revisers = seen
        .filter((r) => r.trace?.role === 'targeted_reviser')
        .map((r) => r.trace?.activityId ?? '');
      for (const ch of [1, 2]) {
        expect(revisers).toContain(`revise:${ch}:prose:r1:p1`);
        expect(revisers).toContain(`revise:${ch}:prose:r1:p2`);
      }
      const sets = await pool.query<{
        payload: {
          clusters: number;
          applied: { start: number; end: number }[];
          dropped: unknown[];
        };
      }>(
        "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'patch_set' AND key LIKE '%:r1'",
        [projectId],
      );
      expect(sets.rows).toHaveLength(2);
      for (const { payload } of sets.rows) {
        expect(payload.clusters).toBe(2);
        // A sub-patch that does not anchor is recorded and dropped; the other one still applies.
        expect(payload.applied).toHaveLength(breakSecondPatch ? 1 : 2);
        expect(payload.dropped).toHaveLength(breakSecondPatch ? 1 : 0);
      }
      // Each envelope patch reproduces its revision from the parent version.
      const patches = await pool.query<{
        payload: {
          from_version_id: string;
          to_version_id: string;
          span: { start: number; end: number };
          new_text: string;
        };
      }>(
        "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'patch' AND key LIKE '%:r1'",
        [projectId],
      );
      expect(patches.rows).toHaveLength(2);
      for (const { payload: p } of patches.rows) {
        const texts = await pool.query<{ id: string; text: string }>(
          'SELECT id, text FROM manuscript_versions WHERE id = ANY($1)',
          [[p.from_version_id, p.to_version_id]],
        );
        const byId = new Map(texts.rows.map((r) => [r.id, r.text]));
        const parent = Array.from(byId.get(p.from_version_id) ?? '');
        expect(
          parent.slice(0, p.span.start).join('') + p.new_text + parent.slice(p.span.end).join(''),
        ).toBe(byId.get(p.to_version_id));
      }

      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 300_000);
  });
}

multiPatchRun('Korean novel run under standard.v10: multi-patch revision rounds (ADR-0077)', false);
multiPatchRun(
  'Korean novel run under standard.v10: an unanchored sub-patch is dropped, the rest applied (ADR-0077)',
  true,
);

run(
  'Korean novel run under standard.v12: same-model judging, prompt ceiling, lines (ADR-0081)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    // The simulated writer breaks lines inside blocks, as Gemini did live; v12 makes each line a paragraph.
    const lineBroken = (req: ProviderRequest, out: ReturnType<typeof script>) =>
      req.trace?.role === 'scene_writer' && 'text' in out && typeof out.text === 'string'
        ? { text: out.text.replace(/\n\n/g, '\n') }
        : out;
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = lineBroken(req, batchedScript(req, script(req)));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v12-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@12',
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

    it('pins the 4.6.0 judges and writer, keeps every prompt Korean and every line a paragraph', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v12-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      for (const role of ['prose_judge', 'structure_judge', 'voice_judge', 'genre_judge']) {
        const calls = seen.filter((r) => r.trace?.role === role);
        expect(calls.length, role).toBeGreaterThan(0);
        for (const r of calls) {
          expect(r.system).toMatch(/판정 순서/);
          expect(r.system).toMatch(/점수 기준표\(1~5\)/);
          expect(r.user).toMatch(/"weakest_passages"/);
        }
      }
      const writers = seen.filter((r) => r.trace?.role === 'scene_writer');
      expect(writers.length).toBeGreaterThan(0);
      for (const r of writers) expect(r.system).toMatch(/속마음\(‘ ’\)은 반말 독백으로만 쓴다/);

      // Every stored version keeps one paragraph per line: no line break without a blank line.
      const versions = await pool.query<{ text: string }>(
        'SELECT text FROM manuscript_versions WHERE project_id = $1',
        [projectId],
      );
      expect(versions.rows.length).toBeGreaterThan(0);
      for (const v of versions.rows) expect(/[^\n]\n[^\n]/.test(v.text)).toBe(false);

      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 240_000);
  },
);

run(
  'Korean novel run under standard.v14: the operator voice, the dialogue floor, convergence (ADR-0083, ADR-0084)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    // The simulated planner plans every scene at a tenth of talk with the POV character alone, as G3b did live.
    const quietPlan = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_planner' || !('json' in out)) return out;
      const json = out.json as { scenes?: Record<string, unknown>[] };
      return {
        ...out,
        json: {
          ...json,
          scenes: (json.scenes ?? []).map((sc) => ({
            ...sc,
            dialogue_density_target: 0.1,
            participants: [(sc.pov as { character_id: string }).character_id],
          })),
        },
      };
    };
    // The operator writes one sentence per line; the calibrated layer (lang/ko@7) fails long paragraphs.
    const sentencePerLine = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !('json' in out)) return out;
      const draft = out.json as { text?: unknown };
      return typeof draft.text === 'string'
        ? { ...out, json: { ...draft, text: draft.text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') } }
        : out;
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = sentencePerLine(req, quietPlan(req, batchedScript(req, script(req))));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    // The scripted writer narrates in the third person, as the v12 scenario does.
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v14-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@14',
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

    it('gives writers and judges the operator voice, raises the planned talk and keeps every prompt Korean', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v14-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      const writers = seen.filter((r) => r.trace?.role === 'scene_writer');
      expect(writers.length).toBeGreaterThan(0);
      for (const r of writers) {
        expect(r.system).toContain('## 작가 문체 (작가 원고에서 잰 기준)');
        // No corpus passages in this database: the studio exemplars stay.
        expect(r.system).toContain('스튜디오가 직접 쓴 합성 문장');
        // The raised target reaches the writer.
        expect(r.user).toContain('대사 비중 목표: 약 20%');
        // The reader secrets the leak checker judges against close every scene plan.
        expect(r.user).toContain('독자에게 아직 밝히지 않는 비밀');
        // No premise device in this intake: no device section.
        expect(r.system).not.toContain('## 장치 어휘 (절대)');
      }
      for (const role of ['prose_judge', 'structure_judge', 'voice_judge']) {
        const calls = seen.filter((r) => r.trace?.role === role);
        expect(calls.length, role).toBeGreaterThan(0);
        for (const r of calls) expect(r.system).toContain('## 이 작가의 문체 (결함 아님)');
      }
      for (const r of seen.filter((x) => x.trace?.role === 'scene_planner'))
        expect(r.system).toContain('## 작가의 구성 습관');

      const plans = await pool.query<{
        payload: { scenes: { dialogue_density_target: number }[] };
      }>("SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_plan'", [
        projectId,
      ]);
      expect(plans.rows.length).toBeGreaterThan(0);
      for (const p of plans.rows)
        for (const sc of p.payload.scenes)
          expect(sc.dialogue_density_target).toBeGreaterThanOrEqual(0.2);

      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 240_000);
  },
);

run(
  'Korean novel run under standard.v15: the reveal schedule, countable talk targets, the cut, the plan critic (ADR-0086)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    // The simulated planner forbids talk in every scene and ends the last scene on a transition, as G5r did live.
    const quietPlan = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_planner' || !('json' in out)) return out;
      const json = out.json as { scenes?: Record<string, unknown>[] };
      return {
        ...out,
        json: {
          ...json,
          scenes: (json.scenes ?? []).map((sc) => ({
            ...sc,
            must_not: ['전투 중 불필요하게 대화하는 모습'],
          })),
        },
      };
    };
    const sentencePerLine = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !('json' in out)) return out;
      const draft = out.json as { text?: unknown };
      return typeof draft.text === 'string'
        ? { ...out, json: { ...draft, text: draft.text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') } }
        : out;
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = sentencePerLine(req, quietPlan(req, batchedScript(req, script(req))));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v15-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@15',
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

    it('plans with the schedule and the critic, gives the writer countable targets and the cut, keeps prompts Korean', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v15-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      // The planners read the schedule; the critic ran once per chapter before any drafting call.
      for (const role of ['chapter_planner', 'scene_planner']) {
        const calls = seen.filter((r) => r.trace?.role === role);
        expect(calls.length, role).toBeGreaterThan(0);
        for (const r of calls) expect(r.user, role).toContain('[공개 일정');
      }
      const critics = seen.filter((r) => r.trace?.role === 'plan_critic');
      expect(critics.length).toBeGreaterThan(0);
      for (const r of critics) {
        expect(r.user).toContain('[구조 목표');
        expect(r.user).toContain('따옴표 대사');
      }
      const writers = seen.filter((r) => r.trace?.role === 'scene_writer');
      expect(writers.length).toBeGreaterThan(0);
      for (const r of writers) {
        expect(r.user).toContain('대사 목표: 따옴표 대사');
        expect(r.user).toContain('[공개 일정]');
      }
      // The last scene of every chapter carries the cut; no talk ban survives into a plan.
      expect(writers.some((r) => r.user.includes('절단: 이 장면은 회차의 마지막 장면이다'))).toBe(
        true,
      );
      const plans = await pool.query<{
        payload: {
          scenes: { must_not?: string[]; beats: { type: string }[] }[];
          plan_findings?: { rule: string }[];
        };
      }>("SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_plan'", [
        projectId,
      ]);
      expect(plans.rows.length).toBeGreaterThan(0);
      for (const p of plans.rows) {
        for (const sc of p.payload.scenes) expect(sc.must_not ?? []).toEqual([]);
        expect(p.payload.scenes.at(-1)?.beats.at(-1)?.type).toBe('cliffhanger');
        expect((p.payload.plan_findings ?? []).map((f) => f.rule)).toContain('PLAN-DLG-02');
      }
      // Every contract lists its reader guards (the workflow fills them from the schedule).
      const contracts = await pool.query<{ payload: { reader_guards?: unknown[] } }>(
        "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'chapter_contract'",
        [projectId],
      );
      expect(contracts.rows.length).toBeGreaterThan(0);
      for (const c of contracts.rows) expect(Array.isArray(c.payload.reader_guards)).toBe(true);

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
  'Korean novel run under standard.v16: a pacing finding patches rarely repair is answered by a scene rewrite (ADR-0087)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    let paced = 0;
    // The first structure judgment of chapter 1 reports a pacing major that quotes nothing, as G5r's did live.
    const pacing = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'structure_judge' || !('json' in out) || paced > 0) return out;
      paced++;
      const json = out.json as Record<string, unknown>;
      return {
        ...out,
        json: {
          ...json,
          issues: [
            {
              kind: 'weak_pacing',
              severity: 'major',
              claim: '대사 비중이 낮아 인물 사이의 주고받음이 없다.',
              quote: '',
              confidence: 0.9,
            },
          ],
        },
      };
    };
    const sentencePerLine = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !('json' in out)) return out;
      const draft = out.json as { text?: unknown };
      return typeof draft.text === 'string'
        ? { ...out, json: { ...draft, text: draft.text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') } }
        : out;
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = sentencePerLine(req, pacing(req, batchedScript(req, script(req))));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v16-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@16',
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

    it('rewrites the quietest scene instead of patching, and the rewrite reaches approval', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v16-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');
      const rewrites = seen.filter((r) => (r.trace?.activityId ?? '').startsWith('scene_rewrite:'));
      expect(rewrites.length).toBe(1);
      expect(rewrites[0]?.user).toContain('다시 쓰기: 이 장면의 앞선 원고는');
      const patches = await pool.query<{ payload: { scope: string } }>(
        "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'patch'",
        [projectId],
      );
      expect(patches.rows.map((r) => r.payload.scope)).toContain('scene');
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
  'Korean novel run under standard.v17: the contract is critiqued before any scene (ADR-0088)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // The operator writes one sentence per line; the calibrated layer (lang/ko@7) fails long paragraphs.
    const sentencePerLine = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !('json' in out)) return out;
      const draft = out.json as { text?: unknown };
      return typeof draft.text === 'string'
        ? { ...out, json: { ...draft, text: draft.text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') } }
        : out;
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return sentencePerLine(req, batchedScript(req, script(req)));
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v17-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@17',
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

    it('runs one contract critique per chapter before the scene plan and completes', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v17-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');
      const contractCritics = seen.filter((r) =>
        /^plan_critic:\d+:contract$/.test(r.trace?.activityId ?? ''),
      );
      const sceneCritics = seen.filter((r) => /^plan_critic:\d+$/.test(r.trace?.activityId ?? ''));
      expect(contractCritics.length).toBeGreaterThan(0);
      expect(contractCritics.length).toBe(sceneCritics.length);
      for (const r of contractCritics) expect(r.user).toContain('계약만 검수한다');
      // The cast designer of 4.8.0 names the hero among the knowers of what he remembers.
      const designers = seen.filter((r) => r.trace?.role === 'character_designer');
      expect(designers.length).toBeGreaterThan(0);
      for (const r of designers) expect(r.system).toContain('known_by에 주인공의 이름을 넣는다');
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v18: design answers lose copied tags, relationships are dated, the overlay speaks the device (ADR-0089)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // The operator writes one sentence per line; the calibrated layer (lang/ko@8) fails long paragraphs.
    const sentencePerLine = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !('json' in out)) return out;
      const draft = out.json as { text?: unknown };
      return typeof draft.text === 'string'
        ? { ...out, json: { ...draft, text: draft.text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') } }
        : out;
    };
    // G7's designers copied provenance tags into their answers; the hero's register toward the mentor begins in 화 1.
    const g7Answers = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (!('json' in out)) return out;
      const role = req.trace?.role;
      if (role === 'concept_generator') {
        const c = out.json as { logline?: string };
        return { json: { ...c, logline: `[FACT] ${c.logline ?? ''}` } };
      }
      if (role === 'power_system_designer') {
        const p = out.json as { world_rules?: { statement?: string }[] };
        return {
          json: {
            ...p,
            world_rules: (p.world_rules ?? []).map((r, i) =>
              i === 0 ? { ...r, statement: `[PLANNED] ${r.statement ?? ''}` } : r,
            ),
          },
        };
      }
      if (role === 'character_designer') {
        const cast = out.json as {
          characters?: { role?: string; registers?: Record<string, unknown>[] }[];
        };
        return {
          json: {
            ...cast,
            characters: (cast.characters ?? []).map((c) =>
              c.role === 'protagonist'
                ? { ...c, registers: (c.registers ?? []).map((r) => ({ ...r, since_chapter: 1 })) }
                : c,
            ),
          },
        };
      }
      return out;
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return sentencePerLine(req, g7Answers(req, batchedScript(req, script(req))));
    });
    // A regression serial: the premise device is 회귀, so the 회빙환 overlay must not speak of a 원작.
    const intake = {
      ...INTAKE,
      pov: 'third_limited',
      genre: { primary: 'regression', secondary: ['hunter-gate'] },
    };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v18-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@18',
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

    it('stores untagged design answers, seeds no relationship before it begins and completes', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v18-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');

      // G7-1: the stored concept and the bible facts carry no tag; the raw answer in the call record keeps it.
      const tag = String.raw`\[(FACT|PLANNED|SUMMARY)\]`;
      const tagged = await pool.query<{ kind: string; n: string }>(
        `SELECT kind, count(*) AS n FROM workflow_artifacts
          WHERE project_id = $1 AND payload::text ~ $2 GROUP BY kind`,
        [projectId, tag],
      );
      const kinds = Object.fromEntries(tagged.rows.map((r) => [r.kind, Number(r.n)]));
      expect(kinds.concept).toBeUndefined();
      expect(kinds.power_system).toBeUndefined();
      expect(kinds.llm_output).toBeGreaterThan(0);
      const facts = await pool.query<{ n: string }>(
        'SELECT count(*) AS n FROM facts WHERE project_id = $1 AND value_text ~ $2',
        [projectId, tag],
      );
      expect(Number(facts.rows[0]?.n)).toBe(0);

      // G7-3: the hero's registers begin in 화 1, so none of them is canon from before 화 1; the others are.
      const rels = await pool.query<{ terms: string[] | null }>(
        `SELECT ARRAY(SELECT jsonb_array_elements_text(register->'address_terms')) AS terms
           FROM relationship_states WHERE project_id = $1`,
        [projectId],
      );
      const terms = rels.rows.flatMap((r) => r.terms ?? []);
      expect(terms).not.toContain('Senior Baek');
      expect(terms).toContain('kid');
      const voice = seen.filter((r) => r.trace?.role === 'voice_judge');
      expect(voice.some((r) => r.user.includes('이 화에서 시작되는 관계다'))).toBe(true);

      // G7-2: the regression writer reads the overlay in the device's words; lang/ko@8's stock phrases reach it.
      const writers = seen.filter((r) => r.trace?.role === 'scene_writer');
      expect(writers.length).toBeGreaterThan(0);
      for (const r of writers) {
        expect(r.system).toContain('‘지난 생에서는 여기서 죽었다.’');
        expect(r.system).not.toContain('장르 용어: 빙의, 원작');
        expect(r.system).toContain('무기를 고쳐 쥐었다');
      }
      // The cast designer of 4.9.0 dates each relationship.
      const designers = seen.filter((r) => r.trace?.role === 'character_designer');
      for (const r of designers)
        expect(r.system).toContain('since_chapter에 그 관계가 시작되는 회차');
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v19: a first-person scene drafted in the third person is re-drafted (ADR-0090)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // G8r: the writer narrated a first-person scene as “진혁은 …”. The live writer answers in prose (text mode), the
    // form the redrafts inspect. Each first draft opens with three narration lines naming the POV hero (the simulated
    // scene may name another character), and the POV redraft answers in the first person.
    const hero = INTAKE.main_character.name;
    const thirdThenFirst = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      const lines = req.user.includes('시점 다시 쓰기')
        ? [
            '나는 창가에서 숨을 골랐다.',
            '내가 장부를 덮었다.',
            '내 손끝이 떨렸다.',
            text.replaceAll(`${hero}은(는)`, '나는'),
          ]
        : [
            `${hero}은 창가에서 숨을 골랐다.`,
            `${hero}이 장부를 덮었다.`,
            `${hero}의 손끝이 떨렸다.`,
            text,
          ];
      return { text: lines.join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return thirdThenFirst(req, batchedScript(req, script(req)));
    });
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v19-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@19',
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

    it('re-drafts each drifted scene once, keeps the first-person redraft and tells every role the 먼치킨 premise', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v19-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      const writers = seen.filter((r) => r.trace?.role === 'scene_writer');
      const redrafts = writers.filter((r) => (r.trace?.activityId ?? '').endsWith(':pov'));
      expect(redrafts.length).toBeGreaterThan(0);
      for (const r of redrafts) expect(r.user).toContain('시점 다시 쓰기: 이 장면은 1인칭이다.');
      const drafts = await pool.query<{ text: string }>(
        "SELECT payload->>'text' AS text FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_draft'",
        [projectId],
      );
      expect(drafts.rows.length).toBeGreaterThan(0);
      for (const d of drafts.rows) {
        expect(d.text).toContain('나는');
        expect(d.text).not.toContain(`${hero}은 창가에서 숨을 골랐다`);
      }
      // G8-4: the intake's 먼치킨 hero reaches writers, planners and the genre judge as the premise.
      for (const role of ['scene_writer', 'chapter_planner', 'genre_judge'])
        expect(
          seen.some((r) => r.trace?.role === role && r.system.includes('## 주인공 유형')),
        ).toBe(true);
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v25: a scene above the pronoun warn line is re-drafted (ADR-0097)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // G14a r0: 4.41 그/그녀 per 1,000자 against the first-person warn line 2.57. Each first draft opens with twelve
    // pronoun lines (two G12a draft lines the prose judge quoted, alternating); the pronoun redraft answers without them.
    const lines = [
      '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.',
      '그녀의 목소리는 방금 전 레이몬드를 꾸짖을 때보다 훨씬 더 매서웠다.',
    ];
    const pronounsFirst = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      const head = req.user.includes('대명사 다시 쓰기')
        ? []
        : Array.from({ length: 12 }, (_, i) => lines[i % 2] ?? '');
      return { text: [...head, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return pronounsFirst(req, batchedScript(req, script(req)));
    });
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v25-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@25',
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

    it('re-drafts each pronoun-heavy scene once and keeps the redraft', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v25-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      const writers = seen.filter((r) => r.trace?.role === 'scene_writer');
      const redrafts = writers.filter((r) => (r.trace?.activityId ?? '').endsWith(':pronoun'));
      expect(redrafts.length).toBeGreaterThan(0);
      for (const r of redrafts) expect(r.user).toContain('대명사 다시 쓰기: 직전 초고는');
      const drafts = await pool.query<{ text: string }>(
        "SELECT payload->>'text' AS text FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_draft'",
        [projectId],
      );
      expect(drafts.rows.length).toBeGreaterThan(0);
      for (const d of drafts.rows) expect(d.text).not.toContain(lines[0]);
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v28: a chapter that passes its gates is polished and accepted (G17-1)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // G17a: the chapter passed its confirmation, and the polish round then stopped with INTERNAL because the reviser
    // was given the lint's minor findings without naming them as targets. One G12a draft line the prose judge quoted
    // gives every scene a 번역투 marker for the polish round to address.
    const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
    const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return withMarker(req, batchedScript(req, script(req)));
    });
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v28-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@28',
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

    it('runs the polish round on the lint findings and accepts chapter 1', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
        stopAfterChapter: 1,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v28-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      const run = await getNovelRun(pool, projectId);
      expect(run?.last_error ?? null).toBeNull();
      const polish = await pool.query<{ payload: { lint_before: number } }>(
        "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'polish_report'",
        [projectId],
      );
      expect(polish.rows.length).toBeGreaterThan(0);
      const chapter = await pool.query<{ status: string }>(
        'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
        [projectId],
      );
      expect(chapter.rows[0]?.status).toBe('accepted');
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v28: an extractor answer off the canon-delta schema is repaired once (ADR-0102)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // G17a: the live extractor wrote event participants as bare ids. The first extraction here does the same; the
    // repair call (activity `:repair`) answers with the script's own valid items.
    const bareParticipants = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'canon_extractor' || !out || !('json' in out)) return out;
      if (req.trace.activityId.endsWith(':repair')) return out;
      const json = out.json as {
        items?: { type?: string; payload?: { participants?: unknown[] } }[];
      };
      return {
        json: {
          ...json,
          items: (json.items ?? []).map((i) =>
            i.type === 'event' && Array.isArray(i.payload?.participants)
              ? {
                  ...i,
                  payload: {
                    ...i.payload,
                    participants: i.payload.participants.map((p) =>
                      p && typeof p === 'object' ? (p as { entity_id: string }).entity_id : p,
                    ),
                  },
                }
              : i,
          ),
        },
      };
    };
    // The polish run's writer line, so the chapter reaches extraction the same way.
    const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
    const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return bareParticipants(req, withMarker(req, batchedScript(req, script(req))));
    });
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v28-extract');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@28',
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

    it('re-asks the extractor with its errors and the schema shapes, and accepts chapter 1', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
        stopAfterChapter: 1,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v28-extract-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      expect((await getNovelRun(pool, projectId))?.last_error ?? null).toBeNull();
      const extractors = seen.filter((r) => r.trace?.role === 'canon_extractor');
      const repairs = extractors.filter((r) => (r.trace?.activityId ?? '').endsWith(':repair'));
      expect(repairs).toHaveLength(1);
      expect(repairs[0]?.user).toContain('participants/0 must be object');
      expect(repairs[0]?.user).toContain(
        '"role!":"agent|patient|witness|speaker|hearer|mentioned"',
      );
      const chapter = await pool.query<{ status: string }>(
        'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
        [projectId],
      );
      expect(chapter.rows[0]?.status).toBe('accepted');
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v28: a field the extractor repair broke is taken back from the answer it repaired (ADR-0103)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // G17a: the first extraction has bare-id participants (as in ADR-0102's run); the repair fixes them and writes
    // `hypothesis_results` in the shape G17a's second repair invented, where the first answer had an empty list.
    const drift = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'canon_extractor' || !out || !('json' in out)) return out;
      const json = out.json as {
        items?: { type?: string; payload?: { participants?: unknown[] } }[];
      };
      if (req.trace.activityId.endsWith(':repair'))
        return {
          json: {
            ...json,
            hypothesis_results: [
              {
                hypothesis_id: 'MH-1',
                status: 'confirmed',
                note: 'as designed',
                evidence_quotes: [],
              },
            ],
          },
        };
      return {
        json: {
          ...json,
          items: (json.items ?? []).map((i) =>
            i.type === 'event' && Array.isArray(i.payload?.participants)
              ? {
                  ...i,
                  payload: {
                    ...i.payload,
                    participants: i.payload.participants.map((p) =>
                      p && typeof p === 'object' ? (p as { entity_id: string }).entity_id : p,
                    ),
                  },
                }
              : i,
          ),
        },
      };
    };
    // The polish run's writer line, so the chapter reaches extraction the same way.
    const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
    const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return drift(req, withMarker(req, batchedScript(req, script(req))));
    });
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v28-restore');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@28',
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

    it('accepts chapter 1 after one repair, with the first answer’s hypothesis results', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
        stopAfterChapter: 1,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v28-restore-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      expect((await getNovelRun(pool, projectId))?.last_error ?? null).toBeNull();
      const activities = seen
        .filter((r) => r.trace?.role === 'canon_extractor')
        .map((r) => (r.trace?.activityId ?? '').replace(/^.*:(extract:)/u, '$1'));
      expect(activities.filter((a) => a.includes(':repair'))).toEqual(['extract:1:repair']);
      const delta = await pool.query<{ payload: { hypothesis_results?: unknown } }>(
        `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'canon_delta'`,
        [projectId],
      );
      expect(delta.rows.map((r) => r.payload.hypothesis_results)).toEqual([[]]);
      const chapter = await pool.query<{ status: string }>(
        'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
        [projectId],
      );
      expect(chapter.rows[0]?.status).toBe('accepted');
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v28: G17a’s delta shapes — a 1.0 → 1.1 window, a fact dated 1.2, a fact dated only by its item — commit (ADR-0104, ADR-0105)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    // G17a: the planner wrote story time 1.0 → 1.1, the extractor dated a relationship from 1.2 and gave two facts only
    // their items' clocks.
    const narrowWindow = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (!out || !('json' in out)) return out;
      if (req.trace?.role === 'chapter_planner') {
        const json = out.json as { story_time: { end: Record<string, unknown> } };
        return {
          json: {
            ...json,
            story_time: { ...json.story_time, end: { ...json.story_time.end, ordinal: 1 } },
          },
        };
      }
      if (req.trace?.role !== 'canon_extractor') return out;
      const json = out.json as {
        items: { evidence: unknown[]; payload: { participants?: { entity_id: string }[] } }[];
      };
      const [event] = json.items;
      const hero = event?.payload.participants?.[0]?.entity_id;
      if (!event || !hero) return out;
      const at = { chapter_no: 1, ordinal: 2, precision: 'exact' };
      const fact = {
        local_id: 'f-seat',
        type: 'fact',
        op: 'assert',
        frame: 'canonical',
        confidence: 1,
        importance: 'minor',
        story_clock: at,
        payload: { entity_id: hero, attribute: 'status.seat', value: 'front_row', valid_from: at },
        evidence: event.evidence,
      };
      const later = { chapter_no: 1, ordinal: 3, precision: 'exact' };
      const undated = {
        ...fact,
        local_id: 'f-class',
        story_clock: later,
        payload: { entity_id: hero, attribute: 'status.class', value_text: 'F' },
      };
      return { json: { ...json, items: [...json.items, fact, undated] } };
    };
    // The polish run's writer line, so the chapter reaches extraction the same way.
    const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
    const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
    };
    const provider = new MockProvider((req) =>
      narrowWindow(req, withMarker(req, batchedScript(req, script(req)))),
    );
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v28-window');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@28',
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

    it('commits the fact from 1.2 and the undated fact at its item’s clock, and accepts chapter 1', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
        stopAfterChapter: 1,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v28-window-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      expect((await getNovelRun(pool, projectId))?.last_error ?? null).toBeNull();
      const contract = await pool.query<{ payload: { story_time: { end: { ordinal: number } } } }>(
        `SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'chapter_contract'`,
        [projectId],
      );
      expect(contract.rows.map((r) => r.payload.story_time.end.ordinal)).toEqual([1]);
      const facts = await pool.query<{ attribute: string; ord: string }>(
        `SELECT attribute, valid_from_ord::text AS ord FROM facts
          WHERE project_id = $1 AND attribute IN ('status.seat', 'status.class') ORDER BY attribute`,
        [projectId],
      );
      expect(facts.rows).toEqual([
        { attribute: 'status.class', ord: '1000003' },
        { attribute: 'status.seat', ord: '1000002' },
      ]);
      const chapter = await pool.query<{ status: string }>(
        'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
        [projectId],
      );
      expect(chapter.rows[0]?.status).toBe('accepted');
    }, 300_000);
  },
);

run(
  'Korean novel run under standard.v20: a quoteless contract finding is rewritten in the scene it names (ADR-0092)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    // G9r: the contract checker failed an opening criterion with no quote in every scorecard, and no round could
    // target it. Here the first evaluation fails it (the claim names [p1] and the opening); later ones pass it.
    let failedOnce = false;
    const openingCriterion = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'contract_checker' || failedOnce) return out;
      failedOnce = true;
      return {
        json: {
          criteria: [
            {
              criterion_id: 'AC-MH-1',
              passed: false,
              evidence_paragraph_ids: ['p1'],
              note: '첫 문장([p1])이 회차의 사건으로 바로 들어가지 않는다.',
            },
          ],
        },
      };
    };
    const sentencePerLine = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !('json' in out)) return out;
      const draft = out.json as { text?: unknown };
      return typeof draft.text === 'string'
        ? { ...out, json: { ...draft, text: draft.text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') } }
        : out;
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = sentencePerLine(req, openingCriterion(req, batchedScript(req, script(req))));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v20-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@20',
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

    it('sends the failed criterion to a rewrite of scene 1, renders the schedule in the canon lines and completes', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v20-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');
      const rewrites = seen.filter((r) =>
        (r.trace?.activityId ?? '').startsWith('scene_rewrite:1:1:'),
      );
      expect(rewrites.length).toBe(1);
      expect(rewrites[0]?.user).toContain('첫 문장');
      // G9-1: no pack renders a secret with the bible's single reveal chapter any more.
      for (const r of seen) expect(`${r.system}\n${r.user}`).not.toMatch(/; \d+화 이전 공개 금지/);
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
  'Korean novel run under standard.v22: secret owners are named in every canon line (ADR-0094)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    const modelWords = new Set<string>();
    // G9r: the contract checker failed an opening criterion with no quote in every scorecard, and no round could
    // target it. Here the first evaluation fails it (the claim names [p1] and the opening); later ones pass it.
    let failedOnce = false;
    const openingCriterion = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'contract_checker' || failedOnce) return out;
      failedOnce = true;
      return {
        json: {
          criteria: [
            {
              criterion_id: 'AC-MH-1',
              passed: false,
              evidence_paragraph_ids: ['p1'],
              note: '첫 문장([p1])이 회차의 사건으로 바로 들어가지 않는다.',
            },
          ],
        },
      };
    };
    const sentencePerLine = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !('json' in out)) return out;
      const draft = out.json as { text?: unknown };
      return typeof draft.text === 'string'
        ? { ...out, json: { ...draft, text: draft.text.replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') } }
        : out;
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      const out = sentencePerLine(req, openingCriterion(req, batchedScript(req, script(req))));
      for (const m of JSON.stringify(out).matchAll(/[A-Za-z][A-Za-z'’-]+/g)) modelWords.add(m[0]);
      return out;
    });
    const intake = { ...INTAKE, pov: 'third_limited' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v22-e2e');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@22',
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

    it('names every secret owner, sends the failed criterion to scene 1 and completes', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v22-runner',
        leaseSeconds: 30,
      });
      while (await runner.tick()) {
        const r = await getNovelRun(pool, projectId);
        if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
        if (r?.status === 'needs_attention' || r?.status === 'failed') break;
      }
      const after = await getNovelRun(pool, projectId);
      expect(after?.last_error ?? null).toBeNull();
      expect(after?.status).toBe('completed');
      const rewrites = seen.filter((r) =>
        (r.trace?.activityId ?? '').startsWith('scene_rewrite:1:1:'),
      );
      expect(rewrites.length).toBe(1);
      expect(rewrites[0]?.user).toContain('첫 문장');
      // G9-1: no pack renders a secret with the bible's single reveal chapter any more.
      for (const r of seen) expect(`${r.system}\n${r.user}`).not.toMatch(/; \d+화 이전 공개 금지/);
      // G10-5: every secret's owner is a name, never a raw id.
      for (const r of seen)
        expect(`${r.system}\n${r.user}`).not.toMatch(/소유자: [0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(seen.some((r) => r.user.includes('비밀 (소유자: '))).toBe(true);
      const leaks = seen.flatMap((r) =>
        englishLeaks(`${r.system}\n${r.user}`, modelWords).map(
          (w) => `${r.trace?.role ?? '?'}: ${w}`,
        ),
      );
      expect([...new Set(leaks)]).toEqual([]);
    }, 300_000);
  },
);

for (const [label, policyVersion, agrees] of [
  ['standard.v28', 'policy/standard@28', false],
  ['standard.v29', 'policy/standard@29', true],
] as const)
  run(
    `Korean novel run under ${label}: a continuity major that a second reading does not reproduce (ADR-0106)`,
    () => {
      let pool: Pool;
      let workspaceId: string;
      let projectId: string;
      const seen: ProviderRequest[] = [];
      // G17a chapter 2: the continuity checker found nothing in v5, then a blocking finding in the same text 52 s later.
      // Here every first reading of the checker raises one major and every second reading (`:agree`) raises none.
      const doubt = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'continuity_checker') return out;
        if (req.trace.activityId.endsWith(':agree')) return out;
        return {
          json: {
            issues: [
              {
                kind: 'inventory_impossible',
                quote: '원고에 없는 인용',
                canon_ref: 'p1',
                severity: 'major',
                confidence: 0.9,
                claim: '앞 문단에서 내려놓은 가방을 다음 문단에서 다시 멘다.',
              },
            ],
          },
        };
      };
      // The writer line and paragraphing of the polish run, so the chapter passes its lint the same way.
      const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
      const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
        const text = (out.json as { text?: string }).text ?? '';
        return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
      };
      const provider = new MockProvider((req) => {
        seen.push(req);
        return doubt(req, withMarker(req, batchedScript(req, script(req))));
      });
      const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

      beforeAll(async () => {
        pool = await freshDatabase();
        workspaceId = await createWorkspace(pool, `novel-ko-${label}-agreement`);
        ({ projectId } = await createProject(pool, {
          workspaceId,
          title: '재의 장부',
          operatingMode: 'autopilot',
          policyVersion,
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

      it(
        agrees
          ? 'reads the text again, records the doubt as minor and accepts chapter 1'
          : 'lets one reading decide and stops chapter 1 for attention',
        async () => {
          const started = await startNovel(makeDeps(), { projectId, intake });
          await approveConcept(pool, {
            projectId,
            conceptId: started.concepts[0]?.id ?? '',
            autoContinue: true,
            stopAfterChapter: 1,
          });
          const runner = new NovelRunner({
            pool,
            makeDeps,
            runnerId: `ko-${label}-agreement-runner`,
            leaseSeconds: 30,
          });
          while (await runner.tick()) {
            const r = await getNovelRun(pool, projectId);
            if (r?.status === 'needs_attention' || r?.status === 'failed') break;
          }
          const after = await getNovelRun(pool, projectId);
          const rereads = seen.filter(
            (r) => r.trace?.role === 'continuity_checker' && r.trace.activityId.endsWith(':agree'),
          );
          const chapter = await pool.query<{ status: string }>(
            'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
            [projectId],
          );
          if (!agrees) {
            expect(after?.status).toBe('needs_attention');
            expect((after?.last_error as { code?: string } | null)?.code).toBe('APPROVAL_BLOCKED');
            expect(rereads).toEqual([]);
            expect(chapter.rows[0]?.status).not.toBe('accepted');
            return;
          }
          expect(after?.last_error ?? null).toBeNull();
          expect(rereads.length).toBeGreaterThan(0);
          const cards = await pool.query<{
            payload: { issues: { kind: string; severity: string; claim: string }[] };
          }>(
            "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scorecard'",
            [projectId],
          );
          const doubts = cards.rows
            .flatMap((r) => r.payload.issues)
            .filter((i) => i.kind === 'inventory_impossible');
          expect(doubts.length).toBeGreaterThan(0);
          for (const d of doubts) {
            expect(d.severity).toBe('minor');
            expect(d.claim).toMatch(/^\(두 번째 판독에서 재현되지 않은 설정 의심\) /u);
          }
          expect(chapter.rows[0]?.status).toBe('accepted');
        },
        300_000,
      );
    },
  );

for (const [label, policyVersion, agrees] of [
  ['standard.v33', 'policy/standard@33', false],
  ['standard.v34', 'policy/standard@34', true],
] as const)
  run(
    `Korean novel run under ${label}: every checker reading raises one major on a different paragraph (ADR-0115)`,
    () => {
      let pool: Pool;
      let workspaceId: string;
      let projectId: string;
      const seen: ProviderRequest[] = [];
      // G22-2: every fresh reading of the same text raised a new major that a second reading "reproduced" by kind. Here
      // each continuity reading quotes the opening of a different paragraph: one evaluation's readings take consecutive
      // paragraphs from a point its activity id picks, so no two readings of one evaluation quote the same paragraph.
      const doubt = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'continuity_checker') return out;
        const paragraphs = [...req.user.matchAll(/\[p\d+\] ([^\n]{12,})/gu)].map((m) => m[1] ?? '');
        if (!paragraphs.length) return out;
        const id = req.trace.activityId;
        const suffix = /:(c\d+|agree)$/u.exec(id)?.[1];
        const offset = suffix === 'agree' ? 1 : suffix ? Number(suffix.slice(1)) - 1 : 0;
        const base = id.replace(/:(c\d+|agree)$/u, '');
        const seed = createHash('sha256').update(base).digest()[0] ?? 0;
        const pick = paragraphs[(seed + offset) % paragraphs.length] ?? '';
        return {
          json: {
            issues: [
              {
                kind: 'inventory_impossible',
                quote: Array.from(pick).slice(0, 12).join(''),
                severity: 'major',
                confidence: 0.9,
                claim: '앞에서 내려놓은 물건이 다른 곳에서 다시 나온다.',
              },
            ],
          },
        };
      };
      // The writer line and paragraphing of the polish run, so the chapter passes its lint the same way.
      const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
      const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
        const text = (out.json as { text?: string }).text ?? '';
        return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
      };
      const provider = new MockProvider((req) => {
        seen.push(req);
        return doubt(req, withMarker(req, batchedScript(req, script(req))));
      });
      const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

      beforeAll(async () => {
        pool = await freshDatabase();
        workspaceId = await createWorkspace(pool, `novel-ko-${label}-consensus`);
        ({ projectId } = await createProject(pool, {
          workspaceId,
          title: '재의 장부',
          operatingMode: 'autopilot',
          policyVersion,
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

      it(
        agrees
          ? 'decides each finding by three readings and accepts chapter 1'
          : 'chases a new reproduced major every round and stops chapter 1 for attention',
        async () => {
          const started = await startNovel(makeDeps(), { projectId, intake });
          await approveConcept(pool, {
            projectId,
            conceptId: started.concepts[0]?.id ?? '',
            autoContinue: true,
            stopAfterChapter: 1,
          });
          const runner = new NovelRunner({
            pool,
            makeDeps,
            runnerId: `ko-${label}-consensus-runner`,
            leaseSeconds: 30,
          });
          while (await runner.tick()) {
            const r = await getNovelRun(pool, projectId);
            if (r?.status === 'needs_attention' || r?.status === 'failed') break;
          }
          const after = await getNovelRun(pool, projectId);
          const checks = seen.filter((r) => r.trace?.role === 'continuity_checker');
          const extra = checks.filter((r) => /:c[23]$/u.test(r.trace?.activityId ?? ''));
          const chapter = await pool.query<{ status: string }>(
            'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
            [projectId],
          );
          if (!agrees) {
            expect(after?.status).toBe('needs_attention');
            expect(extra).toEqual([]);
            expect(chapter.rows[0]?.status).not.toBe('accepted');
            expect((after?.last_error as { code?: string } | null)?.code).toBe('APPROVAL_BLOCKED');
            // Each reading's major stood (its kind reproduced) and each round chased a new paragraph.
            const heavy = await pool.query<{ quote: string | null }>(
              `SELECT i->'chapter_span'->>'quote' AS quote
                 FROM workflow_artifacts a, jsonb_array_elements(a.payload->'issues') i
                WHERE a.project_id = $1 AND a.kind = 'scorecard'
                  AND i->>'kind' = 'inventory_impossible' AND i->>'severity' = 'major'`,
              [projectId],
            );
            expect(new Set(heavy.rows.map((r) => r.quote)).size).toBeGreaterThanOrEqual(3);
            return;
          }
          expect(after?.last_error ?? null).toBeNull();
          expect(extra.length).toBeGreaterThan(0);
          expect(checks.some((r) => r.trace?.activityId.endsWith(':agree'))).toBe(false);
          const cards = await pool.query<{
            payload: { issues: { kind: string; severity: string; claim: string }[] };
          }>(
            "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scorecard'",
            [projectId],
          );
          const doubts = cards.rows
            .flatMap((r) => r.payload.issues)
            .filter((i) => i.kind === 'inventory_impossible');
          expect(doubts.length).toBeGreaterThan(0);
          for (const d of doubts) {
            expect(d.severity).toBe('minor');
            expect(d.claim).toMatch(/^\(3회 판독 중 1회만 주요 결함으로 지적\) /u);
          }
          expect(chapter.rows[0]?.status).toBe('accepted');
        },
        300_000,
      );
    },
  );

for (const [label, policyVersion, agrees] of [
  ['standard.v33', 'policy/standard@33', false],
  ['standard.v34', 'policy/standard@34', true],
] as const)
  run(
    `Korean novel run under ${label}: after a patch every reading raises a new major on unchanged text (ADR-0115)`,
    () => {
      let pool: Pool;
      let workspaceId: string;
      let projectId: string;
      const seen: ProviderRequest[] = [];
      // G22-2 with agreeing readings: every reading of r0 raises one major on the third paragraph; after each patch every
      // reading raises a new major on an untouched paragraph near the end; the confirmation raises nothing.
      const doubt = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'continuity_checker') return out;
        const paragraphs = [...req.user.matchAll(/\[p\d+\] ([^\n]{12,})/gu)].map((m) => m[1] ?? '');
        const m = /:r(\d+)(:full)?/u.exec(req.trace.activityId);
        const round = Number(m?.[1] ?? 0);
        if (m?.[2] || paragraphs.length < 8) return { json: { issues: [] } };
        const pick = round === 0 ? paragraphs[2] : paragraphs[paragraphs.length - round];
        return {
          json: {
            issues: [
              {
                kind: 'inventory_impossible',
                quote: Array.from(pick ?? '')
                  .slice(0, 12)
                  .join(''),
                severity: 'major',
                confidence: 0.9,
                claim: '앞에서 내려놓은 물건이 다른 곳에서 다시 나온다.',
              },
            ],
          },
        };
      };
      // The writer line and paragraphing of the polish run, so the chapter passes its lint the same way.
      const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
      const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
        const text = (out.json as { text?: string }).text ?? '';
        return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
      };
      const provider = new MockProvider((req) => {
        seen.push(req);
        return doubt(req, withMarker(req, batchedScript(req, script(req))));
      });
      const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

      beforeAll(async () => {
        pool = await freshDatabase();
        workspaceId = await createWorkspace(pool, `novel-ko-${label}-ledger`);
        ({ projectId } = await createProject(pool, {
          workspaceId,
          title: '재의 장부',
          operatingMode: 'autopilot',
          policyVersion,
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

      it(
        agrees
          ? 'holds the new finding for the one confirmation and accepts chapter 1'
          : 'chases the new finding every round and stops chapter 1 for attention',
        async () => {
          const started = await startNovel(makeDeps(), { projectId, intake });
          await approveConcept(pool, {
            projectId,
            conceptId: started.concepts[0]?.id ?? '',
            autoContinue: true,
            stopAfterChapter: 1,
          });
          const runner = new NovelRunner({
            pool,
            makeDeps,
            runnerId: `ko-${label}-ledger-runner`,
            leaseSeconds: 30,
          });
          while (await runner.tick()) {
            const r = await getNovelRun(pool, projectId);
            if (r?.status === 'needs_attention' || r?.status === 'failed') break;
          }
          const after = await getNovelRun(pool, projectId);
          const checks = seen.filter((r) => r.trace?.role === 'continuity_checker');
          const extra = checks.filter((r) => /:c[23]$/u.test(r.trace?.activityId ?? ''));
          const chapter = await pool.query<{ status: string }>(
            'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
            [projectId],
          );
          if (!agrees) {
            expect(after?.status).toBe('needs_attention');
            expect(extra).toEqual([]);
            expect(chapter.rows[0]?.status).not.toBe('accepted');
            expect((after?.last_error as { code?: string } | null)?.code).toBe('APPROVAL_BLOCKED');
            // Each reading's major stood (its kind reproduced) and each round chased a new paragraph.
            const heavy = await pool.query<{ quote: string | null }>(
              `SELECT i->'chapter_span'->>'quote' AS quote
                 FROM workflow_artifacts a, jsonb_array_elements(a.payload->'issues') i
                WHERE a.project_id = $1 AND a.kind = 'scorecard'
                  AND i->>'kind' = 'inventory_impossible' AND i->>'severity' = 'major'`,
              [projectId],
            );
            expect(new Set(heavy.rows.map((r) => r.quote)).size).toBeGreaterThanOrEqual(3);
            return;
          }
          expect(after?.last_error ?? null).toBeNull();
          // One confirmation (three readings), after the round that patched the r0 finding.
          const full = checks.filter((r) => /:full(:c\d+)?$/u.test(r.trace?.activityId ?? ''));
          expect(full.map((r) => r.trace?.activityId.replace(/^.*?:r/u, 'r'))).toEqual([
            'r1:full',
            'r1:full:c2',
            'r1:full:c3',
          ]);
          const cards = await pool.query<{
            payload: { issues: { kind: string; severity: string; claim: string }[] };
          }>(
            "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scorecard' ORDER BY created_at, id",
            [projectId],
          );
          const found = cards.rows.map((r) =>
            r.payload.issues
              .filter((i) => i.kind === 'inventory_impossible')
              .map((i) => i.severity),
          );
          expect(found[0]).toEqual(['major']);
          expect(found[1]).toEqual(['minor']);
          const held = cards.rows[1]?.payload.issues.find((i) => i.kind === 'inventory_impossible');
          expect(held?.claim).toMatch(/^\(앞서 통과한 대목의 새 지적/u);
          expect(chapter.rows[0]?.status).toBe('accepted');
        },
        300_000,
      );
    },
  );

for (const [label, policyVersion, agrees] of [
  ['standard.v34', 'policy/standard@34', false],
  ['standard.v35', 'policy/standard@35', true],
] as const)
  run(
    `Korean novel run under ${label}: the reviser's patches leave a real slip in place (ADR-0116)`,
    () => {
      let pool: Pool;
      let workspaceId: string;
      let projectId: string;
      const seen: ProviderRequest[] = [];
      // G21-1: rounds kept because other findings improved while one real slip survived. Every reading flags the sentence
      // planted in scene 1 (the reviser's patch prefixes a word and keeps it), the third and eleventh other paragraphs
      // while untouched, and the third once patched exactly once (a slip the first patch brings): 3, 2, then 1 majors.
      const slip = '그는 손을 번쩍 들어';
      const doubt = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'continuity_checker') return out;
        const finding = (quote: string) => ({
          kind: 'inventory_impossible',
          quote,
          severity: 'major',
          confidence: 0.9,
          claim: '앞에서 내려놓은 물건이 다른 곳에서 다시 나온다.',
        });
        const head = (l: string) => Array.from(l).slice(0, 12).join('');
        const others = [...req.user.matchAll(/\[p\d+\] ([^\n]{12,})/gu)]
          .map((m) => m[1] ?? '')
          .filter((l) => !l.includes(slip));
        const issues = req.user.includes(slip) ? [finding(slip)] : [];
        for (const l of [others[2], others[10]])
          if (l && !l.startsWith('문득 ')) issues.push(finding(head(l)));
        const third = others[2];
        if (third?.startsWith('문득 ') && !third.startsWith('문득 문득 '))
          issues.push(finding(head(third)));
        return { json: { issues } };
      };
      // The writer line and paragraphing of the polish run, so the chapter passes its lint the same way.
      const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
      const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
        const text = (out.json as { text?: string }).text ?? '';
        const first = /^scene_draft:\d+:1(:|$)/u.test(req.trace.activityId);
        return {
          text: [...(first ? [marker] : []), text]
            .join('\n\n')
            .replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n'),
        };
      };
      const provider = new MockProvider((req) => {
        seen.push(req);
        return doubt(req, withMarker(req, batchedScript(req, script(req))));
      });
      const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

      beforeAll(async () => {
        pool = await freshDatabase();
        workspaceId = await createWorkspace(pool, `novel-ko-${label}-escalation`);
        ({ projectId } = await createProject(pool, {
          workspaceId,
          title: '재의 장부',
          operatingMode: 'autopilot',
          policyVersion,
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

      it(
        agrees
          ? 'tells the reviser in round 2 that the slip survived its patch'
          : 'patches the surviving slip again without saying it survived',
        async () => {
          const started = await startNovel(makeDeps(), { projectId, intake });
          await approveConcept(pool, {
            projectId,
            conceptId: started.concepts[0]?.id ?? '',
            autoContinue: true,
            stopAfterChapter: 1,
          });
          const runner = new NovelRunner({
            pool,
            makeDeps,
            runnerId: `ko-${label}-escalation-runner`,
            leaseSeconds: 30,
          });
          while (await runner.tick()) {
            const r = await getNovelRun(pool, projectId);
            if (r?.status === 'needs_attention' || r?.status === 'failed') break;
          }
          // r1 fixed the two other findings and was kept with the slip still in place.
          const kept = await pool.query<{ n: number }>(
            "SELECT count(*)::int AS n FROM quarantine_versions WHERE project_id = $1 AND rejection_reason = 'patch_regressed:r1'",
            [projectId],
          );
          expect(kept.rows[0]?.n).toBe(0);
          const secondRound = seen.filter(
            (r) => r.trace?.role === 'targeted_reviser' && /:r2(:|$)/u.test(r.trace.activityId),
          );
          expect(secondRound.length).toBeGreaterThan(0);
          const told = secondRound.some((r) =>
            r.user.includes('지난 수정 뒤에도 이 결함이 그대로 남았다'),
          );
          expect(told).toBe(agrees);
        },
        300_000,
      );
    },
  );

run(
  'Korean novel run under standard.v28: a resume after a rejected extraction asks the extractor again (ADR-0107)',
  () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // ADR-0103's deferred case: every answer of the first extraction (and both repairs) is off the schema in a way no
    // restore can fix, so the extraction is rejected; the extractor answers validly only when asked again.
    const rejectedFirst = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'canon_extractor' || !out || !('json' in out)) return out;
      if (req.trace.activityId.includes(':retry')) return out;
      return { json: { ...(out.json as object), items: [{ type: 'event', payload: {} }] } };
    };
    const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
    const withMarker = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      return { text: [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n') };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return rejectedFirst(req, withMarker(req, batchedScript(req, script(req))));
    });
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, 'novel-ko-v28-extract-retry');
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion: 'policy/standard@28',
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

    it('fails on the rejection, then asks again on resume and accepts chapter 1', async () => {
      const started = await startNovel(makeDeps(), { projectId, intake });
      await approveConcept(pool, {
        projectId,
        conceptId: started.concepts[0]?.id ?? '',
        autoContinue: true,
        stopAfterChapter: 1,
      });
      const runner = new NovelRunner({
        pool,
        makeDeps,
        runnerId: 'ko-v28-extract-retry-runner',
        leaseSeconds: 30,
      });
      const drive = async () => {
        while (await runner.tick()) {
          const r = await getNovelRun(pool, projectId);
          if (r?.status === 'needs_attention' || r?.status === 'failed') break;
        }
      };
      await drive();
      const failed = await getNovelRun(pool, projectId);
      expect(failed?.status).toBe('failed');
      expect((failed?.last_error as { code?: string } | null)?.code).toBe('EXTRACTION_REJECTED');
      const firstAsks = seen.filter((r) => r.trace?.role === 'canon_extractor').length;
      expect(firstAsks).toBe(3);

      await resumeNovelRun(pool, { projectId });
      await drive();
      expect((await getNovelRun(pool, projectId))?.last_error ?? null).toBeNull();
      const retries = seen.filter(
        (r) => r.trace?.role === 'canon_extractor' && r.trace.activityId.includes(':retry1'),
      );
      expect(retries.length).toBe(1);
      const rejections = await pool.query<{ key: string }>(
        "SELECT key FROM workflow_artifacts WHERE project_id = $1 AND kind = 'extraction_rejection'",
        [projectId],
      );
      expect(rejections.rows).toHaveLength(1);
      const chapter = await pool.query<{ status: string }>(
        'SELECT status FROM chapters WHERE project_id = $1 AND number = 1',
        [projectId],
      );
      expect(chapter.rows[0]?.status).toBe('accepted');
    }, 300_000);
  },
);

for (const [label, policyVersion, redrafts] of [
  ['standard.v30', 'policy/standard@30', false],
  ['standard.v31', 'policy/standard@31', true],
] as const)
  run(
    `Korean novel run under ${label}: a scene that mixes 존대 and 반말 inside quotations (ADR-0111)`,
    () => {
      let pool: Pool;
      let workspaceId: string;
      let projectId: string;
      const seen: ProviderRequest[] = [];
      // G20r: the pawnshop owner's lines switched between 해요체 and 반말 inside one quotation six times.
      const mixed = [
        '“그건 제 사정이에요. 당장 나가.”',
        '“백만 원이요. 낼 돈은 있고?”',
        '“기다려요. 금방 끝나.”',
      ];
      const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
      const writer = (req: ProviderRequest, out: ReturnType<typeof script>) => {
        if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
        const text = (out.json as { text?: string }).text ?? '';
        const lines = [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n');
        if (req.trace.activityId.endsWith(':register')) return { text: lines };
        return { text: [lines, ...mixed].join('\n\n') };
      };
      const provider = new MockProvider((req) => {
        seen.push(req);
        return writer(req, batchedScript(req, script(req)));
      });
      const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

      beforeAll(async () => {
        pool = await freshDatabase();
        workspaceId = await createWorkspace(pool, `novel-ko-${label}-register`);
        ({ projectId } = await createProject(pool, {
          workspaceId,
          title: '재의 장부',
          operatingMode: 'autopilot',
          policyVersion,
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

      it(
        redrafts
          ? 're-drafts each mixing scene once with the utterances named and keeps the re-draft'
          : 'keeps the mixing scenes as drafted',
        async () => {
          const started = await startNovel(makeDeps(), { projectId, intake });
          await approveConcept(pool, {
            projectId,
            conceptId: started.concepts[0]?.id ?? '',
            autoContinue: true,
            stopAfterChapter: 1,
          });
          const runner = new NovelRunner({
            pool,
            makeDeps,
            runnerId: `ko-${label}-register-runner`,
            leaseSeconds: 30,
          });
          while (await runner.tick()) {
            const r = await getNovelRun(pool, projectId);
            if (r?.status === 'needs_attention' || r?.status === 'failed') break;
          }
          const rewrites = seen.filter(
            (r) => r.trace?.role === 'scene_writer' && r.trace.activityId.endsWith(':register'),
          );
          const drafts = await pool.query<{ payload: { text: string } }>(
            "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_draft'",
            [projectId],
          );
          expect(drafts.rows.length).toBeGreaterThan(0);
          if (!redrafts) {
            expect(rewrites).toEqual([]);
            expect(drafts.rows.every((r) => r.payload.text.includes(mixed[0] ?? ''))).toBe(true);
            return;
          }
          expect(rewrites).toHaveLength(drafts.rows.length);
          expect(rewrites[0]?.user).toContain('말높이 다시 쓰기');
          expect(rewrites[0]?.user).toContain(mixed[1]);
          expect(drafts.rows.some((r) => r.payload.text.includes(mixed[0] ?? ''))).toBe(false);
        },
        300_000,
      );
    },
  );

for (const [label, policyVersion, redrafts] of [
  ['standard.v31', 'policy/standard@31', false],
  ['standard.v32', 'policy/standard@32', true],
] as const)
  run(`Korean novel run under ${label}: a scene drafted far over its target (ADR-0112)`, () => {
    let pool: Pool;
    let workspaceId: string;
    let projectId: string;
    const seen: ProviderRequest[] = [];
    // G20a: scene 2 came back at 2.05× its planned length. Here every first draft is padded to three times its length.
    const marker = '그는 손을 번쩍 들어 당장이라도 내 멱살을 잡을 듯 씩씩거렸다.';
    const writer = (req: ProviderRequest, out: ReturnType<typeof script>) => {
      if (req.trace?.role !== 'scene_writer' || !out || !('json' in out)) return out;
      const text = (out.json as { text?: string }).text ?? '';
      const lines = [marker, text].join('\n\n').replace(/([.!?])[ \t]+(?=\S)/g, '$1\n\n');
      if (req.trace.activityId.endsWith(':length')) return { text: lines };
      const pad: string[] = [];
      for (let i = 0; lines.length + pad.join('\n\n').length < lines.length * 3; i++)
        pad.push(`채움 문장 ${String(i)}번이다.`);
      return { text: [lines, ...pad].join('\n\n') };
    };
    const provider = new MockProvider((req) => {
      seen.push(req);
      return writer(req, batchedScript(req, script(req)));
    });
    const intake = { ...INTAKE, pov: 'first', protagonist_type: '먼치킨' };

    beforeAll(async () => {
      pool = await freshDatabase();
      workspaceId = await createWorkspace(pool, `novel-ko-${label}-length`);
      ({ projectId } = await createProject(pool, {
        workspaceId,
        title: '재의 장부',
        operatingMode: 'autopilot',
        policyVersion,
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

    it(
      redrafts
        ? 're-drafts each overlong scene once toward its target'
        : 'keeps the overlong scenes',
      async () => {
        const started = await startNovel(makeDeps(), { projectId, intake });
        await approveConcept(pool, {
          projectId,
          conceptId: started.concepts[0]?.id ?? '',
          autoContinue: true,
          stopAfterChapter: 1,
        });
        const runner = new NovelRunner({
          pool,
          makeDeps,
          runnerId: `ko-${label}-length-runner`,
          leaseSeconds: 30,
        });
        while (await runner.tick()) {
          const r = await getNovelRun(pool, projectId);
          if (r?.status === 'needs_attention' || r?.status === 'failed') break;
        }
        const rewrites = seen.filter(
          (r) => r.trace?.role === 'scene_writer' && r.trace.activityId.endsWith(':length'),
        );
        const drafts = await pool.query<{ payload: { text: string } }>(
          "SELECT payload FROM workflow_artifacts WHERE project_id = $1 AND kind = 'scene_draft'",
          [projectId],
        );
        expect(drafts.rows.length).toBeGreaterThan(0);
        if (!redrafts) {
          expect(rewrites).toEqual([]);
          expect(drafts.rows.every((r) => r.payload.text.includes('채움 문장'))).toBe(true);
          return;
        }
        expect(rewrites).toHaveLength(drafts.rows.length);
        expect(rewrites[0]?.user).toContain('분량 다시 쓰기');
        expect(drafts.rows.some((r) => r.payload.text.includes('채움 문장'))).toBe(false);
      },
      300_000,
    );
  });
