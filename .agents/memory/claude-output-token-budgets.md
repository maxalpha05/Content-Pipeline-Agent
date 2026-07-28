---
name: Claude output token budgets
description: Long structured LLM outputs (verbatim transcript segments) need large max_tokens or they truncate silently
---
Any pipeline stage whose output embeds verbatim transcript segments (e.g. clip discovery: 4-6 clips + summary) needs a generous `max_tokens` (16k+). 

**Why:** A 4096 cap truncated a real discovery run mid-clip — only 3 of 6 clips and no summary — with HTTP 200 and no error, so it looked like model drift rather than truncation.

**How to apply:** When an LLM output looks incomplete (missing trailing sections, cut mid-sentence), check `max_tokens` / stop_reason before blaming the prompt or parser.
