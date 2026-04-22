import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, pipelineRunsTable, creativeConstraintsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";
import {
  ANALYST_EPISODE_PROMPT,
  RESEARCH_ANALYST_PROMPT,
  SURGERY_ANALYST_PROMPT,
  WRITER_EPISODE_PROMPT,
  WRITER_CLIP_PROMPT,
  EDITOR_PROMPT,
  EDITOR_EPISODE_PROMPT,
  EDITOR_FEEDBACK_PROMPT,
} from "./prompts";
import {
  searchYouTubeShorts,
  formatYouTubeData,
  extractTopicKeywords,
} from "./youtube";
import type { Response } from "express";

type SendEvent = (data: Record<string, unknown>) => void;

async function callAgent(
  systemPrompt: string,
  userMessage: string,
  model: string = "claude-sonnet-4-6",
  sendEvent?: SendEvent,
  maxTokens: number = 4096,
): Promise<string> {
  let fullResponse = "";

  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
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

async function callAgentWithSearch(
  systemPrompt: string,
  userMessage: string,
  model: string = "claude-sonnet-4-6",
  sendEvent?: SendEvent,
  maxTokens: number = 10000,
): Promise<string> {
  let fullResponse = "";

  const stream = anthropic.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
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
      16000,
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
      EDITOR_EPISODE_PROMPT,
      editorInput,
      "claude-sonnet-4-6",
      sendEvent,
      16000,
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

function extractCreativeConstraints(text: string): string {
  const match = text.match(/## CREATIVE CONSTRAINTS[\s\S]*/i);
  return match ? match[0].trim() : "";
}

function parseConstraintField(raw: string, pattern: RegExp): string | null {
  const match = raw.match(pattern);
  return match ? match[1].trim() : null;
}

function extractSection(text: string, heading: string): string | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"));
  return match ? match[1].trim() : null;
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

    // --- STAGE 1: Fetch YouTube data + Research Analyst (web search enabled) ---
    await db
      .update(pipelineRunsTable)
      .set({ status: "researching", title, updatedAt: new Date() })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "researching", progress: 5 });

    // Fetch YouTube Shorts data before Research Analyst call
    let youtubeDataJson: string | null = null;
    let formattedYoutubeData = "No YouTube Shorts data available.";
    const apiKey = process.env.YOUTUBE_API_KEY;
    logger.info({ apiKeyPresent: !!apiKey, apiKeyLength: apiKey?.length ?? 0 }, "[YouTube] env var check");
    if (apiKey) {
      const keywords = extractTopicKeywords(clipTranscript);
      logger.info({ keywords }, "[YouTube] extracted keywords");

      // Try with topic keywords + "marketing" (most clips are marketing-related)
      let youtubeResults = await searchYouTubeShorts(apiKey, `${keywords} marketing`);

      // Fallback 1: just the keywords alone
      if (youtubeResults.length === 0 && keywords) {
        logger.info("[YouTube] falling back to keywords only");
        youtubeResults = await searchYouTubeShorts(apiKey, keywords);
      }

      // Fallback 2: top 2 keywords + marketing
      if (youtubeResults.length === 0 && keywords) {
        const top2 = keywords.split(" ").slice(0, 2).join(" ");
        logger.info({ top2 }, "[YouTube] falling back to top-2 + marketing");
        youtubeResults = await searchYouTubeShorts(apiKey, `${top2} marketing strategy`);
      }

      if (youtubeResults.length > 0) {
        youtubeDataJson = JSON.stringify(youtubeResults);
        formattedYoutubeData = formatYouTubeData(youtubeResults);
        logger.info({ count: youtubeResults.length }, "[YouTube] results stored");
      } else {
        logger.warn("[YouTube] all queries returned 0 results");
      }
    }

    // Store YouTube data so frontend can display cards during processing
    if (youtubeDataJson) {
      await db
        .update(pipelineRunsTable)
        .set({ youtubeData: youtubeDataJson, updatedAt: new Date() })
        .where(eq(pipelineRunsTable.id, runId));
    }

    const researchUserMessage = `CLIP TRANSCRIPT:\n${clipTranscript}\n\nYOUTUBE DATA (real API data with actual view counts and tags):\n${formattedYoutubeData}\n\nAnalyze the YouTube data directly. Then search Instagram, TikTok, LinkedIn, and Twitter using site: operators for competitive data on those platforms.`;

    const researchOutput = await callAgentWithSearch(
      RESEARCH_ANALYST_PROMPT,
      researchUserMessage,
      "claude-sonnet-4-6",
      sendEvent,
    );

    await db
      .update(pipelineRunsTable)
      .set({
        researchOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    // --- STAGE 2: Surgery Analyst (no web search) ---
    await db
      .update(pipelineRunsTable)
      .set({ status: "analyzing", updatedAt: new Date() })
      .where(eq(pipelineRunsTable.id, runId));

    sendEvent({ type: "stage", stage: "analyzing", progress: 30 });

    const surgeryUserMessage = `COMPETITIVE RESEARCH FINDINGS:\n${researchOutput}\n\nFULL EPISODE TRANSCRIPT:\n${episodeTranscript}\n\nCLIP TRANSCRIPT:\n${clipTranscript}\n\nEvaluate this clip against the three-point structure. Use the episode transcript only to find better opening and closing lines (Intrigue / Close). For the Value section, only reference lines that appear verbatim in the CLIP TRANSCRIPT above.`;

    const surgeryOutput = await callAgent(
      SURGERY_ANALYST_PROMPT,
      surgeryUserMessage,
      "claude-sonnet-4-6",
      sendEvent,
    );

    // Combined analyst output shown in the Brief tab
    const analystOutput = `## COMPETITIVE RESEARCH\n\n${researchOutput}\n\n---\n\n## CLIP SURGERY\n\n${surgeryOutput}`;

    await db
      .update(pipelineRunsTable)
      .set({
        status: "writing",
        surgeryOutput,
        analystOutput,
        updatedAt: new Date(),
      })
      .where(eq(pipelineRunsTable.id, runId));

    // --- STAGE 3: Writer ---
    sendEvent({ type: "stage", stage: "writing", progress: 55 });

    const writerInput = `COMPETITIVE RESEARCH:\n${researchOutput}\n\nCLIP SURGERY:\n${surgeryOutput}\n\nTYPE: ${clipType.toUpperCase()}\n\nCLIP TRANSCRIPT:\n${clipTranscript}`;
    const writerOutput = await callAgent(
      WRITER_CLIP_PROMPT,
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

    // --- STAGE 4: Editor ---
    sendEvent({ type: "stage", stage: "editing", progress: 78 });

    const creativeConstraints = extractCreativeConstraints(researchOutput);
    const editorInput = `CREATIVE CONSTRAINTS FROM RESEARCH:\n${creativeConstraints || "No creative constraints found in research output."}\n\nANALYST BRIEF:\n${analystOutput}\n\nWRITER OUTPUT:\n${writerOutput}`;
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

    // --- Write creative constraints record (always, best-effort parsing) ---
    try {
      const raw = creativeConstraints || "## CREATIVE CONSTRAINTS\nInsufficient data to constrain. Writer's discretion.";
      const titleConstraints = raw.match(/### TITLE CONSTRAINTS([\s\S]*?)(?=###|$)/i)?.[1] ?? "";
      const hookConstraints = raw.match(/### HOOK CONSTRAINTS([\s\S]*?)(?=###|$)/i)?.[1] ?? "";
      const tagConstraints = raw.match(/### TAG CONSTRAINTS([\s\S]*?)(?=###|$)/i)?.[1] ?? "";
      const hashtagConstraints = raw.match(/### HASHTAG CONSTRAINTS([\s\S]*?)(?=###|$)/i)?.[1] ?? "";
      const linkedinConstraints = raw.match(/### LINKEDIN POST CONSTRAINTS([\s\S]*?)(?=###|$)/i)?.[1] ?? "";
      const twitterConstraints = raw.match(/### TWITTER POST CONSTRAINTS([\s\S]*?)(?=###|$)/i)?.[1] ?? "";

      const [run] = await db
        .select()
        .from(pipelineRunsTable)
        .where(eq(pipelineRunsTable.id, runId));

      await db.insert(creativeConstraintsTable).values({
        pipelineRunId: runId,
        episodeId: run?.episodeId ?? null,
        clipType,
        topicKeywords: extractTopicKeywords(clipTranscript) || "",
        topicCluster: null,
        constraintsRaw: raw,
        titleVerbRule: parseConstraintField(titleConstraints, /VERB RULE:\s*(.+)/i),
        titleStatRule: parseConstraintField(titleConstraints, /STAT RULE:\s*(.+)/i),
        titleLengthRule: parseConstraintField(titleConstraints, /LENGTH RULE:\s*(.+)/i),
        titleFramingRule: parseConstraintField(titleConstraints, /FRAMING RULE:\s*(.+)/i),
        titleAvoid: parseConstraintField(titleConstraints, /AVOID:\s*(.+)/i),
        hookPattern: parseConstraintField(hookConstraints, /PATTERN:\s*(.+)/i),
        hookFirstWords: parseConstraintField(hookConstraints, /FIRST WORDS:\s*(.+)/i),
        tagsMustInclude: parseConstraintField(tagConstraints, /MUST INCLUDE:\s*(.+)/i),
        tagsPairWith: parseConstraintField(tagConstraints, /PAIR WITH:\s*(.+)/i),
        tagsAvoid: parseConstraintField(tagConstraints, /AVOID:\s*(.+)/i),
        hashtagsMustInclude: parseConstraintField(hashtagConstraints, /MUST INCLUDE:\s*(.+)/i),
        hashtagsPairWith: parseConstraintField(hashtagConstraints, /PAIR WITH:\s*(.+)/i),
        hashtagsFormatRule: parseConstraintField(hashtagConstraints, /FORMAT RULE:\s*(.+)/i),
        linkedinHookFormat: parseConstraintField(linkedinConstraints, /HOOK FORMAT:\s*(.+)/i),
        linkedinLength: parseConstraintField(linkedinConstraints, /LENGTH:\s*(.+)/i),
        linkedinCtaPattern: parseConstraintField(linkedinConstraints, /CTA PATTERN:\s*(.+)/i),
        twitterFormat: parseConstraintField(twitterConstraints, /FORMAT:\s*(.+)/i),
        twitterHashtagRule: parseConstraintField(twitterConstraints, /HASHTAG RULE:\s*(.+)/i),
        finalTitle: extractSection(editorOutput, "TITLE"),
        finalTags: extractSection(editorOutput, "YOUTUBE TAGS"),
        finalHashtags: extractSection(editorOutput, "INSTAGRAM HASHTAGS"),
      });
    } catch (constraintErr) {
      logger.error({ constraintErr, runId }, "Failed to write creative constraints record — pipeline continues");
    }

    sendEvent({
      type: "stage",
      stage: "complete",
      progress: 100,
    });
    sendEvent({ type: "done", runId });
  } catch (err) {
    logger.error({ err, runId }, "Clip pipeline failed");
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
