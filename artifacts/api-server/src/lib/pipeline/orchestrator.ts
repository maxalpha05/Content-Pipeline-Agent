import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, pipelineRunsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import {
  ANALYST_EPISODE_PROMPT,
  ANALYST_CLIP_PROMPT,
  WRITER_EPISODE_PROMPT,
  WRITER_CLIP_PROMPT,
  EDITOR_PROMPT,
  EDITOR_FEEDBACK_PROMPT,
} from "./prompts";
import type { Response } from "express";

type SendEvent = (data: Record<string, unknown>) => void;

async function callAgent(
  systemPrompt: string,
  userMessage: string,
  model: string = "claude-sonnet-4-6",
  sendEvent?: SendEvent,
): Promise<string> {
  let fullResponse = "";

  const stream = anthropic.messages.stream({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      fullResponse += event.delta.text;
      if (sendEvent) {
        sendEvent({ type: "chunk", content: event.delta.text });
      }
    }
  }

  return fullResponse;
}

function generateTitle(type: string, transcript: string): string {
  const firstLine = transcript.trim().split("\n")[0] || "";
  const cleaned = firstLine.replace(/^\d+:\d+:\d+\s*/, "").substring(0, 80);
  return cleaned || `${type} run`;
}

export async function runEpisodePipeline(
  runId: number,
  episodeTranscript: string,
  res: Response,
): Promise<void> {
  const sendEvent: SendEvent = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client disconnected
    }
  };

  try {
    const title = generateTitle("Episode", episodeTranscript);
    await db
      .update(pipelineRunsTable)
      .set({ status: "analyzing", title, updatedAt: new Date() })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "analyzing", progress: 10 });

    const analystOutput = await callAgent(
      ANALYST_EPISODE_PROMPT,
      `Here is the full episode transcript:\n\n${episodeTranscript}`,
      "claude-sonnet-4-6",
      sendEvent,
    );

    await db
      .update(pipelineRunsTable)
      .set({
        status: "writing",
        analystOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "writing", progress: 40 });

    const writerInput = `ANALYST BRIEF:\n${analystOutput}\n\nFULL EPISODE TRANSCRIPT:\n${episodeTranscript}`;
    const writerOutput = await callAgent(
      WRITER_EPISODE_PROMPT,
      writerInput,
      "claude-sonnet-4-6",
      sendEvent,
    );

    await db
      .update(pipelineRunsTable)
      .set({
        status: "editing",
        writerOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "editing", progress: 70 });

    const editorInput = `ANALYST BRIEF:\n${analystOutput}\n\nWRITER OUTPUT:\n${writerOutput}`;
    const editorOutput = await callAgent(
      EDITOR_PROMPT,
      editorInput,
      "claude-sonnet-4-6",
      sendEvent,
    );

    await db
      .update(pipelineRunsTable)
      .set({
        status: "review",
        editorOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({
      type: "stage",
      stage: "complete",
      progress: 100,
    });
    sendEvent({ type: "done", runId });
  } catch (err) {
    logger.error({ err, runId }, "Pipeline failed");
    await db
      .update(pipelineRunsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(pipelineRunsTable.id, runId));
    sendEvent({
      type: "error",
      error: err instanceof Error ? err.message : "Pipeline failed",
    });
  }
}

export async function runClipPipeline(
  runId: number,
  episodeTranscript: string,
  clipTranscript: string,
  clipType: string,
  res: Response,
): Promise<void> {
  const sendEvent: SendEvent = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client disconnected
    }
  };

  try {
    const title = generateTitle("Clip", clipTranscript);
    await db
      .update(pipelineRunsTable)
      .set({ status: "analyzing", title, updatedAt: new Date() })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "analyzing", progress: 10 });

    const analystInput = `FULL EPISODE TRANSCRIPT:\n${episodeTranscript}\n\nCLIP TRANSCRIPT (${clipType.toUpperCase()}):\n${clipTranscript}`;
    const analystOutput = await callAgent(
      ANALYST_CLIP_PROMPT,
      analystInput,
      "claude-sonnet-4-6",
      sendEvent,
    );

    await db
      .update(pipelineRunsTable)
      .set({
        status: "writing",
        analystOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "writing", progress: 40 });

    const writerInput = `ANALYST BRIEF:\n${analystOutput}\n\nCLIP TYPE: ${clipType}\n\nFULL EPISODE TRANSCRIPT:\n${episodeTranscript}\n\nCLIP TRANSCRIPT:\n${clipTranscript}`;
    const writerOutput = await callAgent(
      clipType === "vertical" ? WRITER_CLIP_PROMPT : WRITER_CLIP_PROMPT,
      writerInput,
      "claude-sonnet-4-6",
      sendEvent,
    );

    await db
      .update(pipelineRunsTable)
      .set({
        status: "editing",
        writerOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "editing", progress: 70 });

    const editorInput = `ANALYST BRIEF:\n${analystOutput}\n\nWRITER OUTPUT:\n${writerOutput}`;
    const editorOutput = await callAgent(
      EDITOR_PROMPT,
      editorInput,
      "claude-sonnet-4-6",
      sendEvent,
    );

    await db
      .update(pipelineRunsTable)
      .set({
        status: "review",
        editorOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({
      type: "stage",
      stage: "complete",
      progress: 100,
    });
    sendEvent({ type: "done", runId });
  } catch (err) {
    logger.error({ err, runId }, "Pipeline failed");
    await db
      .update(pipelineRunsTable)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(pipelineRunsTable.id, runId));
    sendEvent({
      type: "error",
      error: err instanceof Error ? err.message : "Pipeline failed",
    });
  }
}

export async function runFeedbackRevision(
  runId: number,
  targetOutput: string,
  feedback: string,
  res: Response,
): Promise<void> {
  const sendEvent: SendEvent = (data) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // client disconnected
    }
  };

  try {
    const [run] = await db
      .select()
      .from(pipelineRunsTable)
      .where(eq(pipelineRunsTable.id, runId));

    if (!run) {
      sendEvent({ type: "error", error: "Run not found" });
      return;
    }

    sendEvent({ type: "stage", stage: "editing", progress: 50 });

    const revisionInput = `ANALYST BRIEF:\n${run.analystOutput || "N/A"}\n\nORIGINAL OUTPUT TO REVISE:\n${targetOutput}\n\nUSER FEEDBACK:\n${feedback}`;
    const revisedOutput = await callAgent(
      EDITOR_FEEDBACK_PROMPT,
      revisionInput,
      "claude-sonnet-4-6",
      sendEvent,
    );

    const existingHistory = run.feedbackHistory
      ? JSON.parse(run.feedbackHistory)
      : [];
    existingHistory.push({
      feedback,
      targetOutput: targetOutput.substring(0, 200),
      revisedOutput,
      timestamp: new Date().toISOString(),
    });

    await db
      .update(pipelineRunsTable)
      .set({
        editorOutput: revisedOutput,
        feedbackHistory: JSON.stringify(existingHistory),
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "complete", progress: 100 });
    sendEvent({ type: "done", runId });
  } catch (err) {
    logger.error({ err, runId }, "Feedback revision failed");
    sendEvent({
      type: "error",
      error: err instanceof Error ? err.message : "Revision failed",
    });
  }
}
