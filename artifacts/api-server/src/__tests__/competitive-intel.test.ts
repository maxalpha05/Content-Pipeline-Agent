import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import { EventEmitter } from "node:events";

const fakeResearch = `## TOPIC CLUSTER
growth-marketing

## COMPETITIVE FINDINGS

### Instagram Reels
Strong engagement on reels under 30s with hooks in the first 2 seconds. Multiple creators landing 100k+ views by leading with a contrarian stat.

### TikTok
Similar pattern, hashtags like #marketingtips and #growthhacks repeat across top videos. Hook in first second is critical.

### LinkedIn Posts
Longer-form posts of 1200+ characters perform consistently well, especially when they open with a question and end with a CTA to follow.

### Twitter/X
Threads with stats hit harder than single tweets. Top threads include 5-7 posts with a stat in the first line.

### Cross-Platform Patterns
Hook in first 2 seconds, specific stat, contrarian framing all repeat across every platform analyzed. Visual continuity and consistent tag use also matter.

## CREATIVE CONSTRAINTS

### TITLE CONSTRAINTS
VERB RULE: use action verbs
STAT RULE: include one number
LENGTH RULE: 8-12 words
FRAMING RULE: contrarian
AVOID: clickbait

### HOOK CONSTRAINTS
PATTERN: question opener
FIRST WORDS: Why / How

### TAG CONSTRAINTS
MUST INCLUDE: marketing
PAIR WITH: growth
AVOID: spam

### HASHTAG CONSTRAINTS
MUST INCLUDE: #marketing
PAIR WITH: #growth
FORMAT RULE: lowercase

### LINKEDIN POST CONSTRAINTS
HOOK FORMAT: question
LENGTH: 1200
CTA PATTERN: follow

### TWITTER POST CONSTRAINTS
FORMAT: thread
HASHTAG RULE: max 2
`;

const fakeEditor = `## TITLE
The Growth Marketing Playbook That Actually Works

## TITLE VARIATIONS
1. Variation one
2. Variation two
3. Variation three

## YOUTUBE TAGS
marketing, growth, strategy

## INSTAGRAM HASHTAGS
#marketing #growth #strategy
`;

vi.mock("../lib/pipeline/youtube", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/pipeline/youtube")>(
      "../lib/pipeline/youtube",
    );
  return {
    ...actual,
    extractTopicKeywords: vi.fn(() => "growth marketing strategy"),
    searchYouTubeShorts: vi.fn(async () => [
      {
        title: "A",
        url: "https://youtu.be/a",
        channel: "c",
        views: 200_000,
        likes: 100,
        comments: 10,
        tags: ["marketing"],
        description: "d",
        thumbnail: "t",
      },
      {
        title: "B",
        url: "https://youtu.be/b",
        channel: "c",
        views: 50_000,
        likes: 10,
        comments: 1,
        tags: ["growth"],
        description: "d",
        thumbnail: "t",
      },
      {
        title: "C",
        url: "https://youtu.be/c",
        channel: "c",
        views: 5_000,
        likes: 5,
        comments: 0,
        tags: ["hustle"],
        description: "d",
        thumbnail: "t",
      },
    ]),
    formatYouTubeData: vi.fn(() => "formatted yt data"),
  };
});

vi.mock("@workspace/integrations-anthropic-ai", () => {
  function streamFor(systemPrompt: string) {
    let text = "OK";
    if (systemPrompt.startsWith("You are the GrowthStack competitive research")) {
      text = fakeResearch;
    } else if (
      systemPrompt.startsWith("You are the GrowthStack clip surgery")
    ) {
      text = "surgery output";
    } else if (systemPrompt.startsWith("You produce platform-specific")) {
      text = "writer output";
    } else if (systemPrompt.startsWith("You are the final quality gate")) {
      text = fakeEditor;
    }
    return {
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_delta",
          delta: { type: "text_delta", text },
        };
      },
    };
  }
  return {
    anthropic: {
      messages: {
        stream: (opts: { system: string }) => streamFor(opts.system),
      },
    },
  };
});

// Mock constraint history + historical context to no-op (avoid extra DB churn)
vi.mock("../lib/pipeline/constraint-history", () => ({
  fetchConstraintHistory: vi.fn(async () => ({ totalRuns: 0 })),
  formatHistoricalContext: vi.fn(() => null),
}));
vi.mock("../lib/competitive-intel/historical-context", () => ({
  getHistoricalContext: vi.fn(async () => ""),
}));

// --- After mocks, import the modules under test ---
const { db, pipelineRunsTable, competitiveIntelligenceTable } = await import(
  "@workspace/db"
);
const { runClipPipeline } = await import("../lib/pipeline/orchestrator");
const { eq } = await import("drizzle-orm");
const appModule = await import("../app");
const supertestModule = await import("supertest");
const app = appModule.default;
const request = supertestModule.default;

process.env.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY ?? "test-key";

class FakeRes extends EventEmitter {
  public chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    return this;
  }
  // Minimal surface used by orchestrator
}

function parseSseEvents(chunks: string[]): Array<Record<string, unknown>> {
  return chunks
    .join("")
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as Record<string, unknown>);
}

async function createTestRun(): Promise<number> {
  const [run] = await db
    .insert(pipelineRunsTable)
    .values({
      type: "clip",
      clipType: "vertical",
      status: "pending",
      episodeTranscript: "Full episode transcript text for testing.",
      clipTranscript: "Clip transcript text about growth marketing strategy.",
    })
    .returning();
  return run.id;
}

const createdRunIds: number[] = [];

afterAll(async () => {
  if (createdRunIds.length > 0) {
    for (const id of createdRunIds) {
      await db.delete(pipelineRunsTable).where(eq(pipelineRunsTable.id, id));
    }
  }
});

describe("Competitive intelligence persistence", () => {
  it("inserts exactly one CI row with expected fields on successful clip run", async () => {
    const runId = await createTestRun();
    createdRunIds.push(runId);

    const res = new FakeRes();
    await runClipPipeline(
      runId,
      "Full episode transcript text for testing.",
      "Clip transcript text about growth marketing strategy.",
      "vertical",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res as any,
    );

    const rows = await db
      .select()
      .from(competitiveIntelligenceTable)
      .where(eq(competitiveIntelligenceTable.pipelineRunId, runId));

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.pipelineRunId).toBe(runId);
    expect(row.clipType).toBe("vertical");
    expect(row.topicKeywords).toBe("growth marketing strategy");
    expect(row.dataQualityScore).toBeGreaterThanOrEqual(1);
    expect(row.dataQualityScore).toBeLessThanOrEqual(10);
    expect(typeof row.sufficientData).toBe("boolean");
    expect(row.sufficientData).toBe(true);
    expect(row.topicCluster).toBe("growth-marketing");
    expect(row.youtubeShortCount).toBe(3);
    expect(row.youtubeTopViews).toBe(200_000);
    expect(row.systemTitle).toContain("Growth Marketing Playbook");
    expect(row.instagramData).toBeTruthy();
    expect(row.tiktokData).toBeTruthy();
    expect(row.linkedinData).toBeTruthy();
    expect(row.twitterData).toBeTruthy();

    const events = parseSseEvents(res.chunks);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("still completes the pipeline when the CI insert throws", async () => {
    const runId = await createTestRun();
    createdRunIds.push(runId);

    const realInsert = db.insert.bind(db);
    const insertSpy = vi.spyOn(db, "insert").mockImplementation((table) => {
      if (table === competitiveIntelligenceTable) {
        return {
          values: () => Promise.reject(new Error("forced CI insert failure")),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      }
      return realInsert(table);
    });

    try {
      const res = new FakeRes();
      await runClipPipeline(
        runId,
        "Full episode transcript text for testing.",
        "Clip transcript text about growth marketing strategy.",
        "vertical",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        res as any,
      );

      const events = parseSseEvents(res.chunks);
      expect(events.some((e) => e.type === "stage" && e.stage === "complete")).toBe(
        true,
      );
      expect(events.some((e) => e.type === "done")).toBe(true);
      expect(events.some((e) => e.type === "error")).toBe(false);

      const [updatedRun] = await db
        .select()
        .from(pipelineRunsTable)
        .where(eq(pipelineRunsTable.id, runId));
      expect(updatedRun.status).toBe("review");

      const rows = await db
        .select()
        .from(competitiveIntelligenceTable)
        .where(eq(competitiveIntelligenceTable.pipelineRunId, runId));
      expect(rows).toHaveLength(0);
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("PATCH /api/competitive-intelligence/:pipelineRunId updates only the two title fields", async () => {
    const runId = await createTestRun();
    createdRunIds.push(runId);

    const seed = {
      pipelineRunId: runId,
      topicKeywords: "seed keywords",
      topicCluster: "seed-cluster",
      clipType: "vertical",
      youtubeShortCount: 2,
      youtubeTopViews: 1234,
      systemTitle: "Seed title",
      dataQualityScore: 7,
      sufficientData: true,
    };
    const [before] = await db
      .insert(competitiveIntelligenceTable)
      .values(seed)
      .returning();

    const response = await request(app)
      .patch(`/api/competitive-intelligence/${runId}`)
      .send({
        userSelectedTitle: "User picked this title",
        userSelectedTitleIndex: 2,
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });

    const [after] = await db
      .select()
      .from(competitiveIntelligenceTable)
      .where(eq(competitiveIntelligenceTable.pipelineRunId, runId));

    expect(after.userSelectedTitle).toBe("User picked this title");
    expect(after.userSelectedTitleIndex).toBe(2);

    // Every other field must be unchanged.
    const ignored = new Set([
      "userSelectedTitle",
      "userSelectedTitleIndex",
    ]);
    for (const key of Object.keys(before) as (keyof typeof before)[]) {
      if (ignored.has(key as string)) continue;
      expect(after[key]).toEqual(before[key]);
    }
  });
});
