/**
 * Gateway contract (docs/06-system/07-model-gateway.md §2). Single-turn, reproducible: a request carries the
 * rendered prompt, the prompt version, the pack reference and — for style-sensitive roles — the Narrative
 * Identity reference with BOTH contract hashes. Nothing here depends on a conversation.
 */
import { type Uuid } from '@yeonjae/domain';

export type ModelClass = 'R' | 'P' | 'M' | 'C' | 'E';

export interface NarrativeIdentityRef {
  readonly blockHash: string;
  readonly identityVersionId: Uuid;
  readonly roleVariant: string;
  readonly outputLanguage: 'en' | 'ko';
  readonly outputLanguageContractHash: string;
  readonly traditionContractHash: string;
}

export interface GatewayRequest {
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly jobId: Uuid;
  readonly activityId: string;
  readonly idempotencyKey: string;
  readonly role: string;
  readonly styleSensitive: boolean;
  readonly manuscriptProducing: boolean;
  readonly promptVersionId: Uuid;
  readonly promptHash: string;
  readonly productionPolicyVersion: string;
  readonly pack: {
    readonly id: Uuid;
    readonly hash: string;
    readonly renderedSystem: string;
    readonly renderedUser: string;
    readonly tokenEstimate: number;
  };
  readonly narrativeIdentityRef?: NarrativeIdentityRef | undefined;
  readonly outputSchemaRef?: string | undefined;
  /**
   * Expected output shape when no schema is validated at the gateway. `json` makes a text response be
   * parsed (fences stripped) and an unparseable one count as `SCHEMA_INVALID` for bounded repair, so a
   * live provider answering in prose where JSON was required is regenerated rather than handed to the
   * workflow as a string. Defaults to `json` when `outputSchemaRef` is set, `text` otherwise.
   */
  readonly outputMode?: 'json' | 'text' | undefined;
  /**
   * The self-contained schema of the model's answer (ADR-0057). Sent to the provider only on a route whose
   * `nativeStructuredOutput` is `json_schema`; every other route receives the request exactly as before, and
   * the gateway's own validation and bounded repair apply either way.
   */
  readonly responseSchema?:
    { readonly name: string; readonly schema: Readonly<Record<string, unknown>> } | undefined;
  readonly params?: Partial<ModelParams> | undefined;
  readonly modelClass: ModelClass;
  /**
   * Retry and backoff for retryable provider failures, from the pinned Production Policy's
   * `provider_retry` block (ADR-0072). Absent: the historical behaviour (the next route immediately, at
   * most four attempts, an empty reply judged by the adapter), so earlier pins replay unchanged.
   */
  readonly retry?: ProviderRetryPolicy | undefined;
}

/** `production-policy.provider_retry` (ADR-0072). */
export interface ProviderRetryPolicy {
  /** Provider attempts per call, repairs and regenerations included; clamped to 1–8. */
  readonly max_attempts: number;
  readonly base_delay_ms: number;
  readonly max_delay_ms: number;
  readonly multiplier: number;
  /** `full`: wait a uniform random share of the exponential delay; `none`: the delay itself. */
  readonly jitter: 'full' | 'none';
  /** An empty completion (no text, no JSON, not a content filter) is a retryable provider fault. */
  readonly retry_empty_reply: boolean;
  /**
   * A declined request (ADR-0080): a `content_filter` finish, a safety block, or (with `detect_text`) a
   * short reply that is a refusal instead of the requested output. Retried on the SAME route with the
   * same request, at most `max_retries` times, then the call fails `MODEL_REFUSED`. Absent: refusals are
   * counted and recorded, and the call proceeds as before.
   */
  readonly refusal?:
    | {
        readonly max_retries: number;
        readonly detect_text: boolean;
      }
    | undefined;
}

export interface ModelParams {
  readonly temperature: number;
  readonly max_tokens: number;
  readonly top_p: number;
  readonly seed: number;
  readonly json_schema_mode: boolean;
}

export type FinishReason = 'stop' | 'length' | 'content_filter' | 'error';

export interface ProviderResponse {
  readonly modelId: string;
  readonly provider: string;
  readonly providerRequestId?: string | undefined;
  readonly text?: string | undefined;
  readonly json?: unknown;
  readonly finishReason: FinishReason;
  readonly usage: { readonly input: number; readonly output: number; readonly cached: number };
  readonly latencyMs: number;
}

export interface ProviderRequest {
  readonly modelId: string;
  readonly system: string;
  readonly user: string;
  readonly params: ModelParams;
  readonly outputSchema?: Record<string, unknown> | undefined;
  /** Native structured output for this call (only on routes that declare the capability). */
  readonly responseFormat?:
    | {
        readonly kind: 'json_schema';
        readonly name: string;
        readonly schema: Readonly<Record<string, unknown>>;
      }
    | undefined;
  /** Workflow trace (role + activity + idempotency key); replay providers may key recordings by it. */
  readonly trace?:
    | { readonly role: string; readonly activityId: string; readonly idempotencyKey: string }
    | undefined;
}

/** Every provider adapter implements exactly this; SDK types never leave the adapter. */
export interface Provider {
  readonly name: string;
  complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>;
}

export interface GatewayResponse {
  readonly llmCallId: Uuid;
  readonly modelId: string;
  readonly provider: string;
  readonly output: { readonly text?: string | undefined; readonly json?: unknown };
  readonly finishReason: FinishReason;
  readonly usage: ProviderResponse['usage'];
  readonly costCents: number;
  readonly latencyMs: number;
  readonly schemaValid: boolean;
  readonly attempts: number;
  readonly outputLanguageCheck?:
    | { readonly performed: true; readonly passed: boolean; readonly englishConfidence: number }
    | { readonly performed: false }
    | undefined;
  readonly replayed: boolean;
}

export class GatewayError extends Error {
  constructor(
    readonly code:
      | 'NARRATIVE_IDENTITY_MISSING'
      | 'OUTPUT_LANGUAGE_CONTRACT_MISSING'
      | 'TRADITION_CONTRACT_MISSING'
      | 'NARRATIVE_IDENTITY_STALE'
      | 'NARRATIVE_IDENTITY_NOT_EMBEDDED'
      | 'OUTPUT_LANGUAGE_UNSUPPORTED'
      | 'OUTPUT_LANGUAGE_FAILED'
      | 'BUDGET_EXHAUSTED'
      | 'RATE_LIMITED'
      | 'PROVIDER_FAILED'
      | 'SCHEMA_INVALID'
      | 'TRUNCATED'
      | 'MODEL_REFUSED',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'GatewayError';
  }
}
