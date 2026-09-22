/**
 * A deterministic, role-scripted stand-in for a live model.
 *
 * It reads the prompt exactly as a real model would — copying registry ids from the canon state, quoting
 * chapter text for evidence — and answers every role in the pipeline with schema-shaped JSON. Two
 * imperfections are deliberate, because they are what live models actually do: scene drafts carry a wrong
 * paragraph table and sloppy spans (normalization must recompute them from the prose), and extraction
 * evidence carries wrong offsets with the right quote (anchoring must relocate them). It exercises the
 * live-output code paths with no credentials and no spend; it is not a substitute for a real provider and
 * never claims prose quality. Exposed as `YEONJAE_PROVIDER_MODE=simulated` for local dry runs.
 */
import { MockProvider, type Provider, type ProviderRequest } from '@yeonjae/gateway';

/**
 * Extract registry entries from a prompt, as a model reading it would. Two renderings occur: the planner
 * brief (`- [uuid] Name (type)`) and the context pack (`Name (type; id uuid)`).
 */
export function registry(prompt: string): { id: string; name: string; type: string }[] {
  const out: { id: string; name: string; type: string }[] = [];
  const re = /- \[([0-9a-f-]{36})\] ([^\n(]+?) \((character|location|organization|ability|term)\)/g;
  for (const m of prompt.matchAll(re))
    out.push({ id: m[1] ?? '', name: (m[2] ?? '').trim(), type: m[3] ?? '' });
  const packRe =
    /\] ([^\n(]+?) \((character|location|organization|ability|term); id ([0-9a-f-]{36})\)/g;
  for (const m of prompt.matchAll(packRe))
    if (!out.some((e) => e.id === m[3]))
      out.push({ id: m[3] ?? '', name: (m[1] ?? '').trim(), type: m[2] ?? '' });
  // Contract rendering: `POV: Name (id uuid) …`, `Participants: Name (id uuid) [role]`, `Locations: Name (id uuid)`.
  const pov = /POV: ([^\n(]+?) \(id ([0-9a-f-]{36})\)/.exec(prompt);
  if (pov && !out.some((e) => e.id === pov[2]))
    out.push({ id: pov[2] ?? '', name: (pov[1] ?? '').trim(), type: 'character' });
  const parts = /Participants: ([^\n]+)\./.exec(prompt)?.[1] ?? '';
  for (const m of parts.matchAll(/([^;(]+?) \(id ([0-9a-f-]{36})\)/g))
    if (!out.some((e) => e.id === m[2]))
      out.push({ id: m[2] ?? '', name: (m[1] ?? '').trim(), type: 'character' });
  const locs = /Locations: ([^\n]+)\./.exec(prompt)?.[1] ?? '';
  for (const m of locs.matchAll(/([^,(]+?) \(id ([0-9a-f-]{36})\)/g))
    if (!out.some((e) => e.id === m[2]))
      out.push({ id: m[2] ?? '', name: (m[1] ?? '').trim(), type: 'location' });
  return out;
}

function propositionIds(prompt: string): string[] {
  return [...prompt.matchAll(/- proposition \[([0-9a-f-]{36})\]/g)].map((m) => m[1] ?? '');
}

export function sceneText(
  chapter: number,
  sceneNo: number,
  protagonist: string,
  mentor: string,
): string {
  const lines = [
    `The ledger page was wrong again, and ${protagonist} knew it before her pen touched the column.`,
    `“You are reading the third page twice,” ${mentor} said from the doorway.`,
    `She did not look up. Chapter ${chapter}, scene ${sceneNo}, and the numbers still refused to add. The gate rota listed eleven hunters. The payroll listed fourteen.`,
    `“Three ghosts,” she said. “Paid every month.”`,
    `${mentor} closed the door behind him. “Then you have until the audit to become someone they cannot ignore.”`,
    `Outside, the measurement bell rang for the evening intake, and ${protagonist} folded the page into her sleeve.`,
  ];
  const filler = Array.from(
    { length: 6 },
    (_, i) =>
      `She counted the cost of that in the only unit she trusted: line ${i + 1} of a ledger nobody else would read, sealed and dated before the bell.`,
  );
  return [...lines, ...filler].join('\n\n');
}

/** A competent live model, by role. Returns `undefined` for roles it does not know. */
export function simulatedModelScript(req: ProviderRequest) {
  const role = req.trace?.role ?? '';
  const prompt = `${req.system}\n${req.user}`;
  const reg = registry(prompt);
  const chars = reg.filter((e) => e.type === 'character');
  const locs = reg.filter((e) => e.type === 'location');
  const protagonist = chars.find((c) => c.name === 'Seo Ji-an') ?? chars[0];
  const mentor = chars.find((c) => c.name === 'Baek Tae-ho') ?? chars[1] ?? chars[0];
  const chapterNo = Number(
    /Chapter (\d+)\./.exec(prompt)?.[1] ??
      /chapter_contract:(\d+)/.exec(req.trace?.activityId ?? '')?.[1] ??
      '1',
  );
  const json = (value: unknown) => ({ json: value });
  switch (role) {
    case 'requirement_interpreter':
      return json({
        items: [
          req_('REQ-001', 'hard', 'premise', premiseOf(prompt)),
          req_('REQ-002', 'hard', 'genre', 'Primary genre hunter-gate with an academy overlay.'),
          req_(
            'REQ-003',
            'hard',
            'forbidden_development',
            'Ji-an revealing the forged ledgers before ch.3',
          ),
          req_('REQ-004', 'hard', 'content_restriction', 'No sexual content'),
          req_('REQ-005', 'hard', 'length', 'Two chapters of about 600 words each.'),
          {
            ...req_(
              'REQ-006',
              'assumption',
              'world',
              'The city has one guild that funds gate defence.',
            ),
            provenance: 'model_inferred',
            rationale: 'The premise names a single guild treasurer.',
          },
        ],
      });
    case 'concept_generator': {
      // Korean prompt family (ADR-0054) phrases the same field in Korean; accept both renderings.
      const angle =
        /Angle seed for this candidate: (.+)/.exec(req.user)?.[1] ??
        /이 후보의 앵글 시드: (.+)/.exec(req.user)?.[1] ??
        'angle';
      return json({
        angle,
        logline: `Seo Ji-an, the accountant who found the ghosts on the payroll, becomes the hunter the guild cannot fire. (${angle.slice(0, 12)})`,
        story_promise:
          'Competence as revenge; every rank she gains is a line item they cannot forge.',
        reader_fantasy: 'Being underestimated and being right.',
        main_conflict:
          'The treasurer who forged the ledgers controls the audit that could expose them.',
        protagonist_sketch: 'Meticulous, dry, slow to trust.',
        chapter_one_hook: 'The payroll lists three hunters who do not exist.',
        ending_direction: 'The ledgers are published; Ji-an keeps her rank but loses the guild.',
        progression_curve: 'F to C across the season through audits turned into raids.',
        differentiators: ['numbers as a weapon', 'an academy arc inside a guild'],
        genre_fit_notes: ['gate rota and measurement bells anchor the hunter-gate core'],
        risk_notes: ['pacing of the ledger reveal'],
      });
    }
    case 'character_designer':
      return json({
        characters: [
          {
            display_name: 'Seo Ji-an',
            role: 'protagonist',
            age_at_start: 29,
            background: 'Former guild accountant.',
            goals: ['Expose the forged ledgers and earn a rank on her own terms.'],
            flaws: ['Distrusts help and mistakes caution for control.'],
            voice_notes: ['Dry, exact, and economical; anger sharpens her observations.'],
            arc: {
              start_state: 'Disgraced accountant who trusts only her records.',
              end_state:
                'Recognized hunter who can trust a team without surrendering her judgment.',
              turning_points: [
                {
                  description: 'Chooses allies over a solitary audit.',
                  chapter_from: 4,
                  chapter_to: 5,
                },
              ],
            },
            short_forms: ['Ji-an'],
            rank: 'F',
            secrets: [
              {
                statement: 'Seo Ji-an keeps a copy of the forged ledgers in her sleeve.',
                known_by: [],
                reveal_not_before_chapter: 3,
              },
            ],
            registers: [
              {
                toward: 'Baek Tae-ho',
                type: 'mentor',
                formality: 3,
                deference: 3,
                familiarity: 1,
                directness: 2,
                contractions: 'neutral',
                address_terms: ['Senior Baek'],
              },
            ],
          },
          {
            display_name: 'Baek Tae-ho',
            role: 'mentor',
            age_at_start: 48,
            background: 'Retired B-rank scout.',
            goals: ['Keep Ji-an alive long enough to choose her own path.'],
            flaws: ['Hides concern behind teasing and old field habits.'],
            voice_notes: ['Blunt, warm, and informal; uses practical comparisons.'],
            arc: 'From retired observer to a mentor willing to stand beside Ji-an publicly.',
            short_forms: ['Tae-ho'],
            rank: 'B',
            registers: [
              {
                toward: 'Seo Ji-an',
                type: 'mentor',
                formality: 1,
                deference: 0,
                familiarity: 3,
                directness: 4,
                contractions: 'free',
                address_terms: ['kid'],
              },
            ],
          },
          {
            display_name: 'Moon Hae-rin',
            role: 'antagonist',
            age_at_start: 35,
            background: 'Guild treasurer.',
            goals: ['Preserve control of the guild and the ledger network.'],
            flaws: ['Underestimates people who lack institutional rank.'],
            voice_notes: [
              'Polished and procedural; turns threats into reasonable-sounding policy.',
            ],
            arc: 'From untouchable treasurer to exposed architect of the forged ledgers.',
            rank: 'A',
            secrets: [{ statement: 'Moon Hae-rin forged the gate-defence ledgers.', known_by: [] }],
          },
        ],
        propositions: [
          {
            statement: 'The guild payroll lists three hunters who do not exist.',
            kind: 'world_rule',
            entity_names: ['Moon Hae-rin'],
          },
        ],
      });
    case 'world_builder':
      return json({
        world_rules: [
          {
            attribute: 'ranks',
            statement: 'Ranks F through S are read from measurement devices at the evening intake.',
            locked: true,
          },
        ],
        locations: [
          { display_name: 'Guild counting house', description: 'Where the ledgers are kept.' },
          { display_name: 'East gate yard', description: 'Muster point for gate runs.' },
        ],
        organizations: [
          {
            display_name: 'Ashen Guild',
            short_forms: ['the Guild'],
            description: 'Funds the city gate defence.',
          },
        ],
        terminology: [{ term: '헌터', decision: 'translate', english: 'hunter' }],
      });
    case 'power_system_designer':
      return json({
        system_rules: [
          {
            attribute: 'advancement',
            statement: 'A rank rises only after a recorded gate clear witnessed by two hunters.',
            locked: true,
          },
        ],
        ranks: [{ name: 'F' }, { name: 'E' }],
        abilities: [
          {
            display_name: 'Ledger sense',
            description: 'Ji-an reads mana flow like a balance sheet.',
            owner: 'Seo Ji-an',
          },
        ],
        milestones: [{ description: 'First recorded clear', chapter_from: 2, chapter_to: 2 }],
      });
    case 'story_architect':
      return json({
        story_promise: 'Competence as revenge.',
        reader_fantasy: 'Being underestimated and being right.',
        main_conflict: 'The treasurer controls the audit.',
        themes: ['numbers', 'trust'],
        protagonist_arc: {
          start_state: 'Disgraced accountant',
          end_state: 'Ranked hunter with the ledgers published',
          turning_points: [{ description: 'First recorded clear', window: { from: 2, to: 2 } }],
        },
        ending: {
          type: 'bittersweet',
          summary: 'The ledgers are published; the guild falls.',
          final_state_assertions: ['The forged ledgers are public.'],
        },
        endgame_requirements: [
          { id: 'EG-1', statement: 'The forged ledgers are public.', kind: 'fact' },
        ],
        seasons: [
          {
            ordinal: 1,
            title: 'Ghost Payroll',
            objective: 'Ji-an discovers the ghosts and takes the intake.',
            entry_state: 'Fired accountant.',
            exit_state: 'Registered F-rank with proof in her sleeve.',
            chapter_range_est: { from: 1, to: 2 },
          },
        ],
        promises: [
          {
            type: 'mystery',
            statement: 'Who are the three ghosts on the payroll?',
            importance: 'core',
            due_min_chapter: 2,
            due_max_chapter: 2,
            related_entity_names: ['Moon Hae-rin'],
          },
        ],
      });
    case 'arc_planner': {
      const ids = reg.map((e) => e.id);
      return json({
        title: 'Ghost Payroll',
        objective: 'Ji-an finds the ghosts and takes the intake.',
        conflict: 'Proof without rank is noise.',
        antagonistic_force: 'The treasurer.',
        stakes: 'The audit.',
        entry_state: 'Fired.',
        exit_state_assertions: ['Ji-an is registered F-rank.'],
        participants: ids.filter((id) => chars.some((c) => c.id === id)),
        locations: locs.map((l) => l.id),
        beats: [
          {
            id: 'arc1.beat.01',
            type: 'setup',
            description: 'The ledger does not add.',
            target_chapter_offset: 0,
            participants: [protagonist?.id ?? ''],
          },
          {
            id: 'arc1.beat.02',
            type: 'progression',
            description: 'The evening intake reads F.',
            target_chapter_offset: 1,
            participants: [protagonist?.id ?? ''],
          },
        ],
      });
    }
    case 'chapter_planner': {
      const props = propositionIds(prompt);
      const p = protagonist?.id ?? '';
      const m = mentor?.id ?? '';
      const loc = locs[0]?.id;
      return json({
        version: 1,
        beat_refs: [`arc1.beat.0${chapterNo}`],
        purpose: `Chapter ${chapterNo}: the ledger and the bell.`,
        reader_experience: 'Dry certainty.',
        must_happen: [
          {
            id: 'MH-1',
            kind: 'event',
            description: 'Ji-an finds the three ghosts on the payroll.',
            entity_ids: [p],
            verifiable_by: 'extraction',
          },
        ],
        must_not_happen: [
          {
            id: 'MN-1',
            description: 'Ji-an revealing the forged ledgers to anyone.',
            source: 'spec',
            requirement_id: 'REQ-003',
          },
        ],
        pov: { character_id: p, person: 'third_limited' },
        participants: [
          { character_id: p, role_in_chapter: 'protagonist', on_page: true },
          { character_id: m, role_in_chapter: 'mentor', on_page: true },
        ],
        locations: loc ? [loc] : [],
        story_time: {
          start: { chapter_no: chapterNo, ordinal: 0, precision: 'exact' },
          end: { chapter_no: chapterNo, ordinal: 99, precision: 'exact' },
        },
        knowledge_deltas: [],
        state_deltas: [],
        relationship_deltas: [],
        setups: [],
        payoffs: [],
        emotional_movement: { start: 'Dry', peak: 'Cold anger', end: 'Resolve' },
        conflict: { type: 'internal', description: 'Proof without rank is noise.' },
        local_satisfaction: [{ type: 'revelation', description: 'Three ghosts on the payroll.' }],
        ending_state: 'Page folded into her sleeve.',
        hook: { type: 'quiet_ominous', description: 'The bell rings for intake.' },
        opening: { type: 'in_medias_res', description: 'The ledger page is wrong again.' },
        scene_count: 2,
        dialogue_density_target: 0.4,
        continuity_risks: [],
        continuity_anchors: [],
        knowledge_guards:
          props.length > 0 && m
            ? [{ character_id: m, must_not_know_proposition_ids: [props[0] ?? ''] }]
            : [],
        acceptance_criteria: [
          {
            id: 'AC-LANG',
            kind: 'deterministic',
            description: 'English',
            check_ref: 'EP-LANG-01',
            threshold: 0.99,
          },
          { id: 'AC-LEN', kind: 'deterministic', description: 'Length', check_ref: 'LEN-01' },
          {
            id: 'AC-MH-1',
            kind: 'judge',
            description: 'Ghosts found',
            check_ref: 'contract_checker:MH-1',
          },
        ],
        length_target: { unit: 'words', value: 600, tolerance_ratio: 0.2 },
      });
    }
    case 'scene_planner': {
      const p = protagonist?.id ?? idFrom(prompt, 0);
      const m = mentor?.id ?? idFrom(prompt, 1);
      const loc = idFrom(prompt, 0, 'location');
      const scene = (n: number) => ({
        scene_no: n,
        objective: n === 1 ? 'The ledger does not add.' : 'The bell rings for intake.',
        pov: { character_id: p, person: 'third_limited' },
        participants: [p, m],
        location_id: loc,
        beats: [
          { type: 'action', description: 'Ji-an reads the page.' },
          { type: 'dialogue', description: 'Tae-ho speaks from the doorway.' },
        ],
        length_target: { unit: 'words', value: 300 },
        speaker_pairs: [
          {
            speaker_id: m,
            addressee_id: p,
            register: {
              formality: 1,
              deference: 0,
              familiarity: 3,
              directness: 4,
              contractions: 'free',
              address_terms: ['kid'],
            },
          },
        ],
      });
      return json({ scenes: [scene(1), scene(2)] });
    }
    case 'scene_writer': {
      const sceneNo = Number(
        /Scene (\d+)|"scene_no":\s*(\d+)/.exec(prompt)?.[1] ??
          /"scene_no":\s*(\d+)/.exec(prompt)?.[1] ??
          '1',
      );
      const ch = Number(/chapter_contract:(\d+)|Chapter (\d+)/.exec(prompt)?.[2] ?? chapterNo);
      const pName = protagonist?.name ?? 'Seo Ji-an';
      const mName = mentor?.name ?? 'Baek Tae-ho';
      const text = sceneText(ch, sceneNo, pName, mName);
      // A live model: right text, sloppy offsets. Paragraph table deliberately wrong; claims fine.
      return json({
        scene_no: sceneNo,
        language: 'en',
        text,
        paragraphs: [{ id: 'p1', start: 0, end: 10, kind: 'narration' }],
        speaker_annotations: [
          {
            utterance_start: 5,
            utterance_end: 9999,
            speaker_id: mentor?.id ?? protagonist?.id ?? idFrom(prompt, 0),
            quote: `“You are reading the third page twice,”`,
          },
        ],
        claims: [
          {
            statement: 'The payroll lists three ghosts.',
            paragraph_id: 'p3',
            entity_ids: [protagonist?.id ?? idFrom(prompt, 0)],
            frame: 'canonical',
          },
        ],
      });
    }
    case 'contract_checker':
      return json({
        criteria: [{ criterion_id: 'AC-MH-1', passed: true, evidence_paragraph_ids: ['p3'] }],
      });
    case 'continuity_checker':
    case 'knowledge_leak_checker':
      return json({ issues: [] });
    case 'prose_judge':
    case 'structure_judge':
    case 'genre_judge':
    case 'voice_judge':
      return json({ dimension_scores: { a: 4 }, judge_score: 86, drift_flags: [], issues: [] });
    case 'canon_extractor': {
      const versionId =
        /manuscript_version_id[^0-9a-f]*([0-9a-f-]{36})/.exec(prompt)?.[1] ?? idFrom(prompt, 0);
      const chapterText = chapterTextOf(prompt);
      const quote = 'The gate rota listed eleven hunters.';
      const p = protagonist?.id ?? idFrom(prompt, 0);
      return json({
        items: [
          {
            local_id: 'ev-ghosts',
            type: 'event',
            op: 'assert',
            frame: 'canonical',
            confidence: 1,
            importance: 'core',
            story_clock: { chapter_no: chapterNo, ordinal: 1, precision: 'exact' },
            payload: {
              type: 'revelation',
              summary: 'Ji-an finds the three ghosts on the payroll.',
              participants: [{ entity_id: p, role: 'agent' }],
              importance: 'core',
            },
            // Wrong offsets on purpose: anchoring must locate the quote.
            evidence: [
              {
                manuscript_version_id: versionId,
                chapter_no: chapterNo,
                paragraph_id: 'p3',
                start: 1,
                end: 5,
                quote,
              },
            ],
          },
        ],
        unresolved_questions: [],
        hypothesis_results: [],
        summary_l1: `Chapter ${chapterNo}: ${chapterText.length > 0 ? 'Ji-an finds three ghosts on the payroll and folds the page into her sleeve as the intake bell rings.' : 'summary'}`,
        ending_hook: 'The bell rings for intake.',
      });
    }
    case 'factual_summarizer':
      return json({
        summary_l1: `Chapter ${chapterNo}: Ji-an finds three ghosts on the payroll as the intake bell rings.`,
        ending_hook: 'The bell rings for intake.',
        state_changes: [],
        knowledge_changes: [],
      });
    case 'assumption_explainer':
      return json({ explanations: [] });
    default:
      return undefined;
  }
}

function req_(id: string, kind: string, category: string, text: string) {
  return {
    id,
    kind,
    category,
    text,
    language: 'en',
    provenance: 'user',
    confirmed_by_user: kind !== 'assumption',
    scope: { level: 'series' },
  };
}
function idFrom(prompt: string, n: number, type?: string): string {
  const entries = registry(prompt).filter((e) => (type ? e.type === type : true));
  return entries[n]?.id ?? entries[0]?.id ?? '00000000-0000-8000-8000-000000000000';
}
function chapterTextOf(prompt: string): string {
  const m = /\[CHAPTER TEXT[^\]]*\]\n([\s\S]*)$/.exec(prompt);
  return m?.[1] ?? '';
}

function premiseOf(prompt: string): string {
  const m = /"premise":\s*"((?:[^"\\]|\\.)*)"/.exec(prompt);
  return m?.[1]?.replace(/\\"/g, '"') ?? 'The premise as given in the intake.';
}

/** A fresh simulated provider (stateful call log per gateway). */
export function simulatedProvider(): Provider {
  return new MockProvider(simulatedModelScript);
}
