/**
 * Narrative Identity Guard (STYLE-GUARD-001, ADR-0027). Fails closed: a style-sensitive request is rejected
 * unless it carries an identity reference with BOTH contract hashes, the referenced block hash matches the
 * bytes actually embedded in the rendered system prompt, the block header is present in that prompt, and the
 * profile version is the one the project currently pins.
 */
import { createHash } from 'node:crypto';
import { HEADER_PREFIX } from '@yeonjae/narrative';
import { GatewayError, type GatewayRequest } from './types.js';

export interface GuardContext {
  /** The identity version the project pins right now; a request with a different version is stale. */
  readonly pinnedIdentityVersionId?: string | undefined;
  /** Optional: the compiler's current hashes for the pinned contracts; when supplied they must match. */
  readonly pinnedOutputLanguageContractHash?: string | undefined;
  readonly pinnedTraditionContractHash?: string | undefined;
}

export interface GuardVerdict {
  readonly checked: boolean;
  readonly blockHash?: string | undefined;
  readonly outputLanguageContractHash?: string | undefined;
  readonly traditionContractHash?: string | undefined;
}

const BLOCK_RE = new RegExp(`${HEADER_PREFIX}[^\\n]*>>[\\s\\S]*?<<END_NARRATIVE_IDENTITY>>`);

export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function extractEmbeddedBlock(system: string): string | undefined {
  const m = BLOCK_RE.exec(system);
  return m?.[0];
}

export function guardRequest(req: GatewayRequest, ctx: GuardContext = {}): GuardVerdict {
  if (!req.styleSensitive) {
    if (req.narrativeIdentityRef) {
      // Harmless but recorded: non-style-sensitive roles may still carry a block (e.g. summarizer_min).
      return { checked: false, blockHash: req.narrativeIdentityRef.blockHash };
    }
    return { checked: false };
  }
  const ref = req.narrativeIdentityRef;
  if (!ref)
    throw new GatewayError(
      'NARRATIVE_IDENTITY_MISSING',
      `role ${req.role} is style-sensitive but carries no Narrative Identity reference`,
    );
  if (!ref.outputLanguageContractHash)
    throw new GatewayError(
      'OUTPUT_LANGUAGE_CONTRACT_MISSING',
      `role ${req.role}: no Output-Language Contract hash`,
    );
  if (!ref.traditionContractHash)
    throw new GatewayError(
      'TRADITION_CONTRACT_MISSING',
      `role ${req.role}: no Narrative-Tradition Contract hash`,
    );
  // The type says 'en' | 'ko'; the runtime check guards data that arrived through JSON.
  const declaredLanguage: string = ref.outputLanguage;
  if (declaredLanguage !== 'en' && declaredLanguage !== 'ko')
    throw new GatewayError(
      'OUTPUT_LANGUAGE_UNSUPPORTED',
      `output language ${declaredLanguage} is not supported`,
    );
  if (ctx.pinnedIdentityVersionId && ctx.pinnedIdentityVersionId !== ref.identityVersionId) {
    throw new GatewayError(
      'NARRATIVE_IDENTITY_STALE',
      `identity ${ref.identityVersionId} is not the pinned version ${ctx.pinnedIdentityVersionId}`,
    );
  }
  if (
    ctx.pinnedOutputLanguageContractHash &&
    ctx.pinnedOutputLanguageContractHash !== ref.outputLanguageContractHash
  ) {
    throw new GatewayError(
      'NARRATIVE_IDENTITY_STALE',
      'Output-Language Contract hash does not match the pinned profile',
    );
  }
  if (
    ctx.pinnedTraditionContractHash &&
    ctx.pinnedTraditionContractHash !== ref.traditionContractHash
  ) {
    throw new GatewayError(
      'NARRATIVE_IDENTITY_STALE',
      'Narrative-Tradition Contract hash does not match the pinned profile',
    );
  }
  const embedded = extractEmbeddedBlock(req.pack.renderedSystem);
  if (!embedded)
    throw new GatewayError(
      'NARRATIVE_IDENTITY_NOT_EMBEDDED',
      `role ${req.role}: the rendered system prompt does not contain a Narrative Identity Block`,
    );
  const actual = sha256(embedded);
  if (actual !== ref.blockHash)
    throw new GatewayError(
      'NARRATIVE_IDENTITY_STALE',
      `embedded block hash ${actual} ≠ referenced ${ref.blockHash}`,
    );
  if (
    // English and Korean blocks (ADR-0055) name the two contract sections in their own language.
    !(embedded.includes('## Output-Language Contract') || embedded.includes('## 출력 언어 계약')) ||
    !(
      embedded.includes('## Narrative-Tradition Contract') || embedded.includes('## 서사 전통 계약')
    )
  ) {
    throw new GatewayError(
      'NARRATIVE_IDENTITY_NOT_EMBEDDED',
      'embedded block lacks one of the two contract sections',
    );
  }
  return {
    checked: true,
    blockHash: actual,
    outputLanguageContractHash: ref.outputLanguageContractHash,
    traditionContractHash: ref.traditionContractHash,
  };
}
