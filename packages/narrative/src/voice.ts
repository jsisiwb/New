/**
 * Operator voice profiles (ADR-0083, C3): the operator's measured voice as rule lines in the manuscript
 * language, loaded from examples/voice-profiles and validated against voice-profile.schema.json. A policy
 * names one (`identity.voice_profile`); novel start copies its lines into the project's composed identity
 * (`preferences.operator_voice`), so a running project reads frozen bytes even after a newer version ships.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValid, type Generated } from '@yeonjae/domain';

export type VoiceProfile = Generated.VoiceProfileSchema.OperatorVoiceProfile;

function defaultDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..', 'examples', 'voice-profiles');
}

export function voiceProfileRef(p: VoiceProfile): string {
  return `${p.id}@${String(p.version)}`;
}

export function loadVoiceProfiles(dir: string = defaultDir()): Map<string, VoiceProfile> {
  const out = new Map<string, VoiceProfile>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.json'))
    .sort()) {
    const p = assertValid<VoiceProfile>(
      'voice-profile.schema.json',
      JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown,
      f,
    );
    const ref = voiceProfileRef(p);
    if (out.has(ref)) throw new Error(`duplicate voice profile ${ref}: versions are immutable`);
    out.set(ref, p);
  }
  return out;
}

export function requireVoiceProfile(
  ref: string,
  profiles: ReadonlyMap<string, VoiceProfile> = loadVoiceProfiles(),
): VoiceProfile {
  const p = profiles.get(ref);
  if (!p)
    throw new Error(`unknown voice profile ${ref}; known: ${[...profiles.keys()].join(', ')}`);
  return p;
}
