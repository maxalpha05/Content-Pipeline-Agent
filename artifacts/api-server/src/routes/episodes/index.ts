import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, episodesTable, pipelineRunsTable } from "@workspace/db";
import { runEpisodePipeline } from "../../lib/pipeline/orchestrator";
import { CLIP_DISCOVERY_PROMPT } from "../../lib/pipeline/prompts";
import { getHistoricalContext } from "../../lib/competitive-intel/historical-context";
import {
  extractTopicKeywords,
  extractTopicKeywordSegments,
} from "../../lib/pipeline/youtube";

const SECTION_LABELS = [
  "SUBSTACK ARTICLE",
  "SUBSTACK NOTE",
  "NEWSLETTER NOTE",
  "LINKEDIN POST",
  "LINKEDIN",
  "TWITTER POST",
  "TWITTER",
  "TWEET",
  "YOUTUBE DESCRIPTION",
  "TITLE VARIATIONS",
  "TITLE",
  "YOUTUBE TAGS",
  "INSTAGRAM HASHTAGS",
  "MARKETING ANGLE",
];

function findSection(text: string, labels: string[]): string | null {
  const stopPattern = SECTION_LABELS.map((l) =>
    l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:${labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[:\\s]*\\n([\\s\\S]*?)(?=\\n\\s*(?:#{1,3}\\s*)?(?:${stopPattern})[:\\s]*\\n|$)`,
    "i"
  );
  const m = text.match(pattern);
  return m ? m[1].trim() : null;
}

function extractFinalPackage(text: string): string {
  const m = text.match(/##\s*FINAL CONTENT PACKAGE[\s\S]*/i);
  return m ? m[0] : text;
}

const router: IRouter = Router();

// Per-episode in-flight guard for discovery scans. Discovery runs ~5 minutes
// and keeps running server-side even if the browser disconnects; without a
// guard, a re-discover (or second tab) clears the stored output and races the
// first run. The lock is in-memory, so a server restart mid-scan naturally
// clears it (no permanent stale lock). The TTL is belt-and-braces in case a
// scan hangs without ever settling.
const DISCOVERY_LOCK_TTL_MS = 15 * 60 * 1000;
const discoveryInFlight = new Map<number, number>(); // episodeId -> startedAt (ms)

function isDiscoveryRunning(episodeId: number): boolean {
  const startedAt = discoveryInFlight.get(episodeId);
  if (startedAt === undefined) return false;
  if (Date.now() - startedAt > DISCOVERY_LOCK_TTL_MS) {
    discoveryInFlight.delete(episodeId);
    return false;
  }
  return true;
}

router.get("/episodes", async (_req, res): Promise<void> => {
  const episodes = await db
    .select()
    .from(episodesTable)
    .orderBy(desc(episodesTable.updatedAt));
  res.json(episodes);
});

router.post("/episodes", async (req, res): Promise<void> => {
  const { episodeName, guestName, fullTranscript } = req.body;

  if (!episodeName || typeof episodeName !== "string" || episodeName.trim() === "") {
    res.status(400).json({ error: "episodeName is required" });
    return;
  }
  if (!guestName || typeof guestName !== "string" || guestName.trim() === "") {
    res.status(400).json({ error: "guestName is required" });
    return;
  }
  if (!fullTranscript || typeof fullTranscript !== "string" || fullTranscript.trim().length < 100) {
    res.status(400).json({ error: "fullTranscript is required (min 100 characters)" });
    return;
  }

  const [episode] = await db
    .insert(episodesTable)
    .values({
      episodeName: episodeName.trim(),
      guestName: guestName.trim(),
      fullTranscript,
      status: "active",
      clipCount: 0,
    })
    .returning();

  res.status(201).json(episode);
});

router.get("/episodes/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid episode id" });
    return;
  }

  const [episode] = await db
    .select()
    .from(episodesTable)
    .where(eq(episodesTable.id, id));

  if (!episode) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  const runs = await db
    .select({
      id: pipelineRunsTable.id,
      type: pipelineRunsTable.type,
      clipType: pipelineRunsTable.clipType,
      status: pipelineRunsTable.status,
      title: pipelineRunsTable.title,
      clipTranscript: pipelineRunsTable.clipTranscript,
      createdAt: pipelineRunsTable.createdAt,
    })
    .from(pipelineRunsTable)
    .where(eq(pipelineRunsTable.episodeId, id))
    .orderBy(desc(pipelineRunsTable.createdAt));

  res.json({ ...episode, runs });
});

router.patch("/episodes/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid episode id" });
    return;
  }

  const {
    episodeName,
    guestName,
    fullTranscript,
    status,
    substackArticle,
    substackNote,
    linkedinPost,
    twitterPost,
    youtubeDescription,
    titleVariations,
  } = req.body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (episodeName !== undefined) updates.episodeName = episodeName;
  if (guestName !== undefined) updates.guestName = guestName;
  if (fullTranscript !== undefined) updates.fullTranscript = fullTranscript;
  if (status !== undefined) updates.status = status;
  if (substackArticle !== undefined) updates.substackArticle = substackArticle;
  if (substackNote !== undefined) updates.substackNote = substackNote;
  if (linkedinPost !== undefined) updates.linkedinPost = linkedinPost;
  if (twitterPost !== undefined) updates.twitterPost = twitterPost;
  if (youtubeDescription !== undefined) updates.youtubeDescription = youtubeDescription;
  if (titleVariations !== undefined) updates.titleVariations = titleVariations;

  const [episode] = await db
    .update(episodesTable)
    .set(updates)
    .where(eq(episodesTable.id, id))
    .returning();

  if (!episode) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  res.json(episode);
});

router.delete("/episodes/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid episode id" });
    return;
  }

  const [episode] = await db
    .delete(episodesTable)
    .where(eq(episodesTable.id, id))
    .returning();

  if (!episode) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  res.sendStatus(204);
});

router.post("/episodes/:id/full-episode", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid episode id" });
    return;
  }

  const [episode] = await db
    .select()
    .from(episodesTable)
    .where(eq(episodesTable.id, id));

  if (!episode) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const [run] = await db
    .insert(pipelineRunsTable)
    .values({
      type: "episode",
      episodeId: episode.id,
      status: "pending",
      episodeTranscript: episode.fullTranscript,
    })
    .returning();

  await runEpisodePipeline(run.id, episode.fullTranscript, res);

  const [completedRun] = await db
    .select({
      editorOutput: pipelineRunsTable.editorOutput,
      writerOutput: pipelineRunsTable.writerOutput,
    })
    .from(pipelineRunsTable)
    .where(eq(pipelineRunsTable.id, run.id));

  if (completedRun?.editorOutput) {
    const finalBlock = extractFinalPackage(completedRun.editorOutput);
    const parsedArticle = findSection(finalBlock, ["SUBSTACK ARTICLE"]);
    const parsedLinkedin = findSection(finalBlock, ["LINKEDIN POST", "LINKEDIN"]);
    const parsedYoutube = findSection(finalBlock, ["YOUTUBE DESCRIPTION"]);
    const parsedYoutubeTags = findSection(finalBlock, ["YOUTUBE TAGS"]);
    const parsedTitles = findSection(finalBlock, ["TITLE VARIATIONS"]);
    await db
      .update(episodesTable)
      .set({
        substackArticle: parsedArticle,
        linkedinPost: parsedLinkedin,
        youtubeDescription: parsedYoutube,
        youtubeTags: parsedYoutubeTags,
        titleVariations: parsedTitles,
        updatedAt: new Date(),
      })
      .where(eq(episodesTable.id, id));
  }

  res.end();
});

router.post("/episodes/:id/discover-clips", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid episode id" });
    return;
  }

  const [episode] = await db
    .select()
    .from(episodesTable)
    .where(eq(episodesTable.id, id));

  if (!episode) {
    res.status(404).json({ error: "Episode not found" });
    return;
  }

  // Reject a second scan while one is already in flight for this episode.
  // Checked BEFORE clearing stored output so a duplicate request cannot wipe
  // a result the running scan is about to (or just did) persist.
  if (isDiscoveryRunning(id)) {
    res.status(409).json({
      error:
        "A discovery scan is already running for this episode. Results are saved automatically when it finishes — refresh in a few minutes.",
    });
    return;
  }
  discoveryInFlight.set(id, Date.now());

  // Re-discover semantics: clear any prior stored output before rerunning so
  // stale data is not retained if the new Claude call fails.
  await db
    .update(episodesTable)
    .set({ discoveryOutput: null, updatedAt: new Date() })
    .where(eq(episodesTable.id, id));

  let historicalContext = "";
  try {
    // Discovery is episode-level (clipType unknown), so derive topic keywords from
    // the full transcript and pull historical context for BOTH orientations.
    // Both blocks are concatenated (with labels) so the agent can weight vertical
    // vs horizontal recommendations against the patterns that have actually worked
    // for each format historically.
    // Long, multi-topic transcripts produce noisy ("growth", "people",
    // "company") keyword bags when summed over the entire transcript, which
    // washes out the actual topic clusters. Extract keywords per segment so
    // each topic cluster in the episode can match historical runs on its own
    // merits — the matcher takes the max relevance over segments and boosts
    // records that hit multiple segments. We also keep the full-transcript
    // bag in the mix so single-topic episodes still match cleanly.
    const segmentKeywords = extractTopicKeywordSegments(
      episode.fullTranscript,
    );
    const fullEpisodeKeywords = extractTopicKeywords(episode.fullTranscript);
    const keywordSets = Array.from(
      new Set([...segmentKeywords, fullEpisodeKeywords].filter(Boolean)),
    );
    const [verticalCtx, horizontalCtx] = await Promise.all([
      getHistoricalContext(keywordSets, "vertical"),
      getHistoricalContext(keywordSets, "horizontal"),
    ]);
    const blocks: string[] = [];
    if (verticalCtx) {
      blocks.push(
        `### VERTICAL CLIP HISTORY (YouTube Shorts / Reels / TikTok)\n\n${verticalCtx}`,
      );
    }
    if (horizontalCtx) {
      blocks.push(
        `### HORIZONTAL CLIP HISTORY (LinkedIn / YouTube main)\n\n${horizontalCtx}`,
      );
    }
    historicalContext = blocks.join("\n");
  } catch (err) {
    req.log.warn({ err }, "[discover-clips] historical-context query failed");
    historicalContext = "";
  }

  const userMessage = `${historicalContext}FULL EPISODE TRANSCRIPT:\n${episode.fullTranscript}\n\nScan this transcript and identify the 4-6 strongest clip-worthy moments.`;

  // Stream the response as SSE. Discovery with web search regularly exceeds
  // the proxy's ~120s limit for buffered responses; the request used to be
  // aborted at exactly 120000ms and the finished output thrown away. Streaming
  // keeps the connection alive, and persistence below is deliberately NOT tied
  // to the client connection — if the browser disconnects mid-run, the run
  // still completes and the result is saved for the next page load.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (data: Record<string, unknown>): void => {
    try {
      if (!res.writableEnded && !res.destroyed) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    } catch {
      // Client went away between the guard and the write — persistence below
      // must not be affected, so swallow the write error.
    }
  };

  // Web-search tool calls produce long gaps with no text deltas; heartbeats
  // keep intermediaries from treating the connection as idle.
  const heartbeat = setInterval(() => {
    try {
      if (!res.writableEnded && !res.destroyed) {
        res.write(": keep-alive\n\n");
      }
    } catch {}
  }, 15000);

  sendEvent({ type: "status", message: "Scanning transcript..." });

  let discoveryOutput = "";
  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      // Discovery output includes 4-6 verbatim transcript segments plus a
      // summary block and per-clip b-roll suggestions; 4096 tokens truncates
      // it mid-clip on real episodes, so keep a generous budget.
      max_tokens: 20000,
      system: CLIP_DISCOVERY_PROMPT,
      // Web search lets the agent ground b-roll suggestions in real, current
      // visuals/formats for each clip's topic. The prompt instructs it to
      // degrade to transcript-only suggestions if search fails.
      tools: [
        {
          type: "web_search_20250305" as const,
          name: "web_search",
          max_uses: 5,
        },
      ],
      messages: [{ role: "user", content: userMessage }],
    });

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        discoveryOutput += event.delta.text;
        sendEvent({ type: "chunk", content: event.delta.text });
      } else if (
        event.type === "content_block_start" &&
        event.content_block?.type === "server_tool_use"
      ) {
        sendEvent({ type: "status", message: "Researching b-roll ideas..." });
      }
    }
  } catch (err) {
    clearInterval(heartbeat);
    discoveryInFlight.delete(id);
    req.log.error({ err, episodeId: id }, "[discover-clips] Claude call failed");
    sendEvent({ type: "error", message: "Clip discovery failed" });
    if (!res.writableEnded) res.end();
    return;
  }

  clearInterval(heartbeat);

  // Persist regardless of whether the client is still connected.
  try {
    await db
      .update(episodesTable)
      .set({ discoveryOutput, updatedAt: new Date() })
      .where(eq(episodesTable.id, id));
    req.log.info(
      { episodeId: id, outputLength: discoveryOutput.length, clientConnected: !res.writableEnded && !res.destroyed },
      "[discover-clips] output persisted",
    );
  } catch (err) {
    discoveryInFlight.delete(id);
    req.log.error({ err, episodeId: id }, "[discover-clips] failed to persist output");
    sendEvent({ type: "error", message: "Failed to save discovery results" });
    if (!res.writableEnded) res.end();
    return;
  }

  discoveryInFlight.delete(id);
  sendEvent({ type: "done", episodeId: id });
  if (!res.writableEnded) res.end();
});

export default router;
