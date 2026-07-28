---
name: SSE for long AI requests
description: Any HTTP response that takes >120s behind the Replit proxy must stream (SSE); buffered JSON gets aborted at exactly 120000ms.
---

The rule: any endpoint whose work can exceed ~2 minutes (web-search-enabled Claude calls take ~5 min here) must stream its response as SSE with periodic keep-alive comments — buffered JSON responses are aborted at exactly 120,000 ms ("request aborted", statusCode null in pino logs) and the finished work is discarded.

**Why:** Clip discovery gained web search and started taking ~5 min; every request died at the 120s proxy limit, the UI spun forever, and retries burned tokens with nothing saved.

**How to apply:**
- Emit heartbeat comments (`: keep-alive`) every ~15s — tool-use phases produce long gaps with no text deltas.
- Persist results server-side independent of the client connection (guard + try/catch around `res.write`; never early-return on disconnect). Verified: a client that disconnects mid-run still gets its output saved.
- Client SSE readers must also parse the trailing buffer after EOF, or a final `done` event without a trailing newline gets missed and success is misreported as an interruption.
