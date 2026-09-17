# Model Gateway

`packages/gateway` is the only path to any LLM or embedding provider (ADR-0004).

## 1. Responsibilities

1. **Provider adapters** — uniform request/response for chat-completion-style APIs (OpenAI-compatible,
   Anthropic-style, Google-style, and OpenAI-compatible self-hosted/open-weight endpoints incl. Kimi-class
   models). Adapters normalize: messages, JSON-schema mode, max tokens, stop, seed, streaming (not used for
   production calls except UI previews), usage & cached-token reporting, request IDs, finish reasons.
2. **Routing** — `routing_table { role → [ {model_id, provider, priority, params_overrides, max_ctx,
   price_in, price_out, price_cached, supports_json_schema, tokenizer_hint} ] }` per environment/workspace.
   Class-based defaults (R/P/M/C/E) with role overrides. Constraints: `judge.family != writer.family` when
   available; extractor B family ≠ A when available.
3. **Narrative Identity Guard** — see `docs/02-narrative-identity/01` §5; fails closed when a style-sensitive
   call lacks a valid Output-Language Contract (English) **or** a valid Narrative-Tradition Contract (Korean
   webnovel), or when the block is stale/not embedded (ADR-0027).
3b. **Output-language check** — post-call, for manuscript-producing roles: deterministic language
   identification on prose segments (registry romanizations and preserved-script contexts excluded); English
   ≥ 0.99 required; failure discards the output and triggers regeneration (FR-4.10).
4. **Budget guard** — pre-call reservation against project/chapter/workflow budgets; release on completion.
5. **Idempotency** — `idempotency_key` lookup in `llm_calls`; returns stored output when completed.
6. **Structured output** — schema attach (native mode) or instruction; validation; repair loop
   coordination (repair is itself a gateway call with role `json_repairer`).
7. **Retries/fallback/circuit breakers** — per reliability plan.
8. **Truncation detection** — `finish_reason=length` surfaced; continuation helper.
9. **Cost accounting** — usage × price table → `cost_cents`; cached tokens priced separately.
10. **Audit** — persist `llm_calls` row (inputs/outputs to encrypted object storage beyond 64 KB) with all
    NFR-A fields; OpenTelemetry span.
11. **Concurrency** — workspace/provider token buckets; fairness across projects.
12. **Privacy** — provider allowlist per workspace; payload minimization checks (no user identity).
13. **Cancellation** — `Provider.complete(req, signal?)` receives a composed `AbortSignal`, and the
    gateway races the call against it, so a durable cancellation reaches a request that is ALREADY RUNNING
    rather than only the next workflow step (ADR-0049). No further attempt, bounded repair or route
    fallback may begin after an authoritative cancellation, and a cancellation is classified `cancelled` —
    never as a retryable provider failure. Five stable reasons (`operator_cancelled`, `timeout`,
    `activity_cancelled`, `worker_shutdown`, `lease_lost`) are carried distinctly, first-cause-wins. A
    cancelled call writes one audit row whose `cancellation` object records what is KNOWN: remote
    cancellation is `acknowledged` only on a positive provider acknowledgement, and post-abort usage and
    billing are `unknown` rather than zero (migration 0012 enforces both rules in the database). A
    response arriving after the abort is discarded; its usage is kept, its content never is.

## 2. Request contract

```ts
type GatewayRequest = {
  workspaceId; projectId; jobId; activityId; idempotencyKey;
  role: RoleName;                         // determines class, style sensitivity, manuscript flag, schema, params
  promptVersionId: string;                // registry
  pack: { id; hash; renderedSystem; renderedUser; tokenEstimate };
  narrativeIdentityRef?: { blockHash; identityVersionId; role; outputLanguage: 'en';
                           outputLanguageContractHash; traditionContractHash };   // required if role.style_sensitive
  outputSchemaRef?: string;
  params?: Partial<ModelParams>;          // bounded by prompt version guards
  budgetScope: { projectId; chapterJobId?; workflowId };
  untrustedSegments?: Array<{ start; end; source }>;   // must be inside user message
};
type GatewayResponse = {
  llmCallId; modelId; provider; output: { text?: string; json?: unknown }; finishReason;
  usage: { input; output; cached }; costCents; latencyMs; schemaValid: boolean; attempts: number;
};
```

## 3. Model class benchmarks (selection procedure, not vendor choice)

Before a model is routed to class **P**, it must pass the **English-under-Korean-webnovel benchmark**:
(a) on 20 fixture scene tasks, outputs pass the output-language check 20/20 and the five-class contrast
evaluation ranks them in the `kwn_english` region (prose_score and structure_score both ≥ the Standard gate
after calibration); (b) bilingual raters prefer the model's output over a `western_english` and a
`translation_like` rendering in ≥ 90% of blind pairs; (c) prose lint translation-marker rate ≤ threshold and
structure lint hook index p90 ≤ 5 on fresh generations; (d) register rendering accuracy ≥ 95% on the
register test set; (e) length control within ±12% of the word target on 20 samples. **Korean-language
writing ability is not a criterion**; the model must write natural English. Class **R** candidates are
validated on the continuity fixture (recall/precision of seeded traps). Class **M** on schema validity rate
≥ 98% and extraction fixture recall. Results recorded in an ops runbook (not user-facing).

## 4. Provider-independence checklist

- No provider SDK types leak outside `packages/gateway/adapters/*`.
- Prompts are provider-neutral; provider-specific system prompt quirks handled by adapter transforms.
- Tokenizer differences: per-model tokenizer hint used for budget estimates (English tokens-per-word
  calibrated per model); manifests record estimate source.
- JSON mode differences handled by adapter; fallback to instruction-mode + repair.
- Prices and context limits are data (routing table), not code.

## 5. Local/test providers

`MockProvider` (deterministic canned outputs keyed by prompt hash for tests), `ReplayProvider` (replays
recorded `llm_calls` for regression tests without spend), `FaultInjectingProvider` (chaos tests).
