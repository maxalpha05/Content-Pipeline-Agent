import { Router, type IRouter } from "express";
import { eq, desc, sql as drizzleSql } from "drizzle-orm";
import { db, pipelineRunsTable, episodesTable } from "@workspace/db";
import {
  CreatePipelineRunBody,
  GetPipelineRunParams,
  DeletePipelineRunParams,
  StreamPipelineRunParams,
  SubmitFeedbackParams,
  SubmitFeedbackBody,
  ApprovePipelineRunParams,
} from "@workspace/api-zod";
import {
  runEpisodePipeline,
  runClipPipeline,
  runFeedbackRevision,
} from "../../lib/pipeline/orchestrator";

const router: IRouter = Router();

router.get("/pipeline/runs", async (_req, res): Promise<void> => {
  const runs = await db
    .select({
      id: pipelineRunsTable.id,
      episodeId: pipelineRunsTable.episodeId,
      type: pipelineRunsTable.type,
      clipType: pipelineRunsTable.clipType,
      status: pipelineRunsTable.status,
      title: pipelineRunsTable.title,
      createdAt: pipelineRunsTable.createdAt,
      updatedAt: pipelineRunsTable.updatedAt,
    })
    .from(pipelineRunsTable)
    .orderBy(desc(pipelineRunsTable.createdAt));
  res.json(runs);
});

router.post("/pipeline/runs", async (req, res): Promise<void> => {
  const parsed = CreatePipelineRunBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { type, clipType, episodeTranscript: bodyTranscript, clipTranscript, episodeId } = parsed.data;

  if (type === "clip" && !clipTranscript) {
    res.status(400).json({ error: "Clip transcript is required for clip runs" });
    return;
  }

  let resolvedTranscript = bodyTranscript || "";
  let resolvedEpisodeId: number | null = episodeId || null;

  if (episodeId) {
    const [episode] = await db
      .select()
      .from(episodesTable)
      .where(eq(episodesTable.id, episodeId));

    if (!episode) {
      res.status(404).json({ error: "Episode not found" });
      return;
    }

    resolvedTranscript = episode.fullTranscript;

    await db
      .update(episodesTable)
      .set({
        clipCount: drizzleSql`${episodesTable.clipCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(episodesTable.id, episodeId));
  } else if (!bodyTranscript) {
    res.status(400).json({ error: "episodeTranscript is required when episodeId is not provided" });
    return;
  }

  const [run] = await db
    .insert(pipelineRunsTable)
    .values({
      type,
      episodeId: resolvedEpisodeId,
      clipType: clipType || null,
      status: "pending",
      episodeTranscript: resolvedTranscript,
      clipTranscript: clipTranscript || null,
    })
    .returning();

  res.status(201).json({
    id: run.id,
    type: run.type,
    episodeId: run.episodeId,
    clipType: run.clipType,
    status: run.status,
    title: run.title,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
});

router.get("/pipeline/runs/:id", async (req, res): Promise<void> => {
  const params = GetPipelineRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [run] = await db
    .select()
    .from(pipelineRunsTable)
    .where(eq(pipelineRunsTable.id, params.data.id));

  if (!run) {
    res.status(404).json({ error: "Pipeline run not found" });
    return;
  }

  res.json({
    ...run,
    episodeId: run.episodeId ?? null,
  });
});

router.delete("/pipeline/runs/:id", async (req, res): Promise<void> => {
  const params = DeletePipelineRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [run] = await db
    .delete(pipelineRunsTable)
    .where(eq(pipelineRunsTable.id, params.data.id))
    .returning();

  if (!run) {
    res.status(404).json({ error: "Pipeline run not found" });
    return;
  }

  if (run.episodeId && run.type === "clip") {
    await db
      .update(episodesTable)
      .set({
        clipCount: drizzleSql`GREATEST(${episodesTable.clipCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(episodesTable.id, run.episodeId));
  }

  res.sendStatus(204);
});

router.get("/pipeline/runs/:id/stream", async (req, res): Promise<void> => {
  const params = StreamPipelineRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [run] = await db
    .select()
    .from(pipelineRunsTable)
    .where(eq(pipelineRunsTable.id, params.data.id));

  if (!run) {
    res.status(404).json({ error: "Pipeline run not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Only start the pipeline for pending runs — prevent re-runs on reconnect
  if (run.status !== "pending") {
    // If already finished, tell the client so it can stop polling
    if (["review", "approved", "failed"].includes(run.status)) {
      res.write(`data: ${JSON.stringify({ type: "stage", stage: "complete", progress: 100 })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done", runId: run.id })}\n\n`);
    }
    // For in-progress runs, just close — polling handles status updates
    res.end();
    return;
  }

  if (run.type === "episode") {
    await runEpisodePipeline(run.id, run.episodeTranscript, res);
  } else {
    await runClipPipeline(
      run.id,
      run.episodeTranscript,
      run.clipTranscript || "",
      run.clipType || "vertical",
      res,
    );
  }

  res.end();
});

router.post("/pipeline/runs/:id/feedback", async (req, res): Promise<void> => {
  const params = SubmitFeedbackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = SubmitFeedbackBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  await runFeedbackRevision(
    params.data.id,
    body.data.targetOutput,
    body.data.feedback,
    res,
  );

  res.end();
});

router.post("/pipeline/runs/:id/rerun", async (req, res): Promise<void> => {
  const params = ApprovePipelineRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [run] = await db
    .update(pipelineRunsTable)
    .set({
      status: "pending",
      analystOutput: null,
      writerOutput: null,
      editorOutput: null,
      researchOutput: null,
      surgeryOutput: null,
      youtubeData: null,
      feedbackHistory: null,
      updatedAt: new Date(),
    })
    .where(eq(pipelineRunsTable.id, params.data.id))
    .returning();

  if (!run) {
    res.status(404).json({ error: "Pipeline run not found" });
    return;
  }

  res.json({ id: run.id, status: run.status });
});

router.post("/pipeline/runs/:id/approve", async (req, res): Promise<void> => {
  const params = ApprovePipelineRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [run] = await db
    .update(pipelineRunsTable)
    .set({ status: "approved", updatedAt: new Date() })
    .where(eq(pipelineRunsTable.id, params.data.id))
    .returning();

  if (!run) {
    res.status(404).json({ error: "Pipeline run not found" });
    return;
  }

  res.json({
    id: run.id,
    type: run.type,
    clipType: run.clipType,
    status: run.status,
    title: run.title,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  });
});

router.get("/pipeline/dashboard", async (_req, res): Promise<void> => {
  const allRuns = await db
    .select({
      id: pipelineRunsTable.id,
      type: pipelineRunsTable.type,
      clipType: pipelineRunsTable.clipType,
      status: pipelineRunsTable.status,
      title: pipelineRunsTable.title,
      createdAt: pipelineRunsTable.createdAt,
      updatedAt: pipelineRunsTable.updatedAt,
    })
    .from(pipelineRunsTable)
    .orderBy(desc(pipelineRunsTable.createdAt));

  const totalRuns = allRuns.length;
  const episodeRuns = allRuns.filter((r) => r.type === "episode").length;
  const clipRuns = allRuns.filter((r) => r.type === "clip").length;
  const approvedRuns = allRuns.filter((r) => r.status === "approved").length;
  const pendingReviewRuns = allRuns.filter((r) => r.status === "review").length;
  const recentRuns = allRuns.slice(0, 10);

  res.json({
    totalRuns,
    episodeRuns,
    clipRuns,
    approvedRuns,
    pendingReviewRuns,
    recentRuns,
  });
});

export default router;
