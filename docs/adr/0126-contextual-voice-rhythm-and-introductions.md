# ADR-0126: Contextual voice rhythm and character introductions

- **Status:** Accepted
- **Date:** 2026-09-27
- **Deciders:** operator request; live chapter-contract critique
- **Relates to:** ADR-0083, ADR-0120, ADR-0121, ADR-0124, ADR-0125

## Context

The bounded academy writing test exposed a remaining conflict: the plan critic's structure targets inherit the voice profile's mandatory heroine introduction formula (appearance, family, original fate and a weakness/quest). The same profile prescribes that romantic initiative always comes from the heroine, and that every dialogue line is followed by narration. Those instructions reintroduce uniform relationships and mechanical rhythm despite the new craft guidance.

## Decision

Publish `voice/operator@5` and `scene_writer@4.15.0`, selected by new-project default `standard.v42`. The new policy differs from v41 only in those identity and prompt pins. Earlier live-test policies remain immutable.

An introduction establishes what the current encounter needs through the new person's own actions and motives. Do not require a biography/fate checklist or one direction of romantic initiative. The reveal schedule and actual character knowledge remain authoritative. Dialogue exchanges, pauses, interiority and narration may vary with the scene instead of obeying one narration beat per spoken line or converting reflection to speech after a fixed number of lines. Brief explanation remains permitted when it makes current choices intelligible. Existing numeric gates, dialogue targets and canon rules are unchanged.

## Consequences

Profile and prompt tests cover the conflicting instructions' replacement and immutable earlier versions. The completed broader suite on v41 remains evidence for unchanged code; new pins, defaults and the complete craft path need focused verification. The live academy test remains pinned to40 and is not presented as a live validation of42's final rhythm amendment.
