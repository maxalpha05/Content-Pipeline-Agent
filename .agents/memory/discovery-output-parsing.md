---
name: Discovery output parsing tolerance
description: Claude drifts from exact section labels in structured discovery output; parser must tolerate qualifiers.
---
Claude sometimes adds parenthetical qualifiers to required section labels in the clip-discovery output (e.g. "**Transcript segment (post-surgery):**" instead of "**Transcript segment:**"), which silently broke strict-regex parsing for some clips.

**Why:** LLM structured output drifts even with an explicit format spec; a strict label regex returns empty fields with no error.

**How to apply:** When parsing labeled sections from LLM output, allow optional parentheticals/qualifiers after the label, AND add an explicit "use labels exactly as written, output is machine-parsed" instruction to the prompt. Verify with one live run, not just fixtures.
