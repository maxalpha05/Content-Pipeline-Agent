import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, episodesTable, pipelineRunsTable } from "@workspace/db";
import { runEpisodePipeline } from "../../lib/pipeline/orchestrator";

function findSection(text: string, labels: string[]): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:#{1,3}\\s*)?(?:${labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[:\\s]*\\n([\\s\\S]*?)(?=\\n\\s*(?:#{1,3}\\s*)?(?:SUBSTACK ARTICLE|SUBSTACK NOTE|NEWSLETTER NOTE|LINKEDIN POST|LINKEDIN|TWITTER POST|TWITTER|TWEET)[:\\s]*\\n|$)`,
    "i"
  );
  const m = text.match(pattern);
  return m ? m[1].trim() : null;
}

const router: IRouter = Router();

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
    const output = completedRun.editorOutput;
    const parsedNote = findSection(output, ["SUBSTACK NOTE", "NEWSLETTER NOTE"]);
    const parsedLinkedin = findSection(output, ["LINKEDIN POST", "LINKEDIN"]);
    const parsedTwitter = findSection(output, ["TWITTER POST", "TWITTER", "TWEET"]);
    await db
      .update(episodesTable)
      .set({
        substackArticle: output,
        substackNote: parsedNote,
        linkedinPost: parsedLinkedin,
        twitterPost: parsedTwitter,
        updatedAt: new Date(),
      })
      .where(eq(episodesTable.id, id));
  }

  res.end();
});

export default router;
