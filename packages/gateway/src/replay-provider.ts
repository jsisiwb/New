/**
 * ReplayProvider: replays recorded provider responses keyed by prompt hash so regression suites run without
 * spend; refuses unknown prompts (a silent live call would be spend and non-determinism). Recordings are plain
 * JSON files: { "<promptKey>": { text?, json?, finishReason?, modelId } }.
 */
import { readFileSync } from 'node:fs';
import { promptKey } from './mock-provider.js';
import {
  type FinishReason,
  type Provider,
  type ProviderRequest,
  type ProviderResponse,
} from './types.js';

export interface Recording {
  readonly text?: string | undefined;
  readonly json?: unknown;
  readonly finishReason?: FinishReason | undefined;
  readonly modelId?: string | undefined;
  readonly usage?: ProviderResponse['usage'] | undefined;
}

export class ReplayProvider implements Provider {
  readonly name: string;
  private readonly recordings: Map<string, Recording>;
  readonly misses: string[] = [];

  constructor(recordings: Record<string, Recording> | Map<string, Recording>, name = 'replay') {
    this.name = name;
    this.recordings = recordings instanceof Map ? recordings : new Map(Object.entries(recordings));
  }

  static fromFile(path: string, name = 'replay'): ReplayProvider {
    return new ReplayProvider(
      JSON.parse(readFileSync(path, 'utf8')) as Record<string, Recording>,
      name,
    );
  }

  async complete(req: ProviderRequest): Promise<ProviderResponse> {
    const key = promptKey(req);
    const rec = this.recordings.get(key);
    if (!rec) {
      this.misses.push(key);
      throw new Error(
        `ReplayProvider: no recording for prompt ${key.slice(0, 12)}… (model ${req.modelId}); refusing to call a live provider`,
      );
    }
    return {
      modelId: rec.modelId ?? req.modelId,
      provider: this.name,
      text: rec.text,
      json: rec.json,
      finishReason: rec.finishReason ?? 'stop',
      usage: rec.usage ?? { input: 0, output: 0, cached: 0 },
      latencyMs: 0,
    };
  }
}
