import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MockProvider, promptKey } from './mock-provider.js';
import { checkOutputLanguage, toNfcText } from '@yeonjae/prose';

const req = {
  modelId: 'mock-p',
  system: 'You write English.',
  user: 'Write scene 1.',
  params: DEFAULT_PARAMS,
};

describe('MockProvider', () => {
  it('returns the same canned output for the same prompt (deterministic replay)', async () => {
    const p = new MockProvider().register(req, { text: 'The device cried.' });
    const a = await p.complete(req);
    const b = await p.complete(req);
    expect(a.text).toBe(b.text);
    expect(promptKey(req)).toBe(promptKey({ ...req }));
    expect(p.callCount).toBe(2);
  });

  it('fails loudly on unregistered prompts unless a script is provided', async () => {
    await expect(new MockProvider().complete(req)).rejects.toThrow(/no canned output/);
    const scripted = new MockProvider((r, n) => ({ text: `call ${n} for ${r.modelId}` }));
    expect((await scripted.complete(req)).text).toBe('call 1 for mock-p');
  });

  it('injects faults: error, truncation, invalid JSON and Korean prose', async () => {
    const p = new MockProvider().register(req, {
      text: 'A long English sentence about a gate that opened.',
    });
    p.injectFault({ kind: 'error' });
    await expect(p.complete(req)).rejects.toThrow(/injected/);
    p.injectFault({ kind: 'truncate' });
    const t = await p.complete(req);
    expect(t.finishReason).toBe('length');
    p.injectFault({ kind: 'korean_prose' });
    const k = await p.complete(req);
    expect(checkOutputLanguage(toNfcText(k.text ?? '')).passed).toBe(false);
    p.injectFault({ kind: 'invalid_json' });
    const j = await p.complete(req);
    expect(() => JSON.parse(j.text ?? '') as unknown).toThrow();
  });
});
