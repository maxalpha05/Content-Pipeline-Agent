import { describe, it, expect, vi, afterAll } from "vitest";
import { EventEmitter } from "node:events";

const DISCOVERY_OUTPUT = `## CLIP 1: Why most SaaS onboarding fails in week one
**Lines:** 142 to 198
**Estimated duration:** 175 words (~70 seconds)
**Clip type:** VERTICAL (under 60 sec)

**Hook assessment:**
"90% of churn happens before users hit value." STRONG

**Value assessment:**
Walks through the 3-step activation loop. STRONG

**Close assessment:**
"Fix week one and you fix the funnel." STRONG

**Surgery notes:**
Trim the 10s lead-in.

**Topic keywords:** saas onboarding activation churn

**Transcript segment:**
\`\`\`
142: So here's the thing about onboarding...
198: ...and that's how you fix it.
\`\`\`

---

## DISCOVERY SUMMARY
- Total clips found: 1
- Strongest overall: Clip 1
- Topic clusters covered: onboarding
`;

const fakeEditor = `## TITLE
Test title
`;

// Track YouTube search calls so we can assert keyword override flows through.
const searchCalls: string[] = [];

vi.mock("../lib/pipeline/youtube", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/pipeline/youtube")>(
      "../lib/pipeline/youtube",
    );
  return {
    ...actual,
    extractTopicKeywords: vi.fn(() => "EXTRACTED_FROM_TRANSCRIPT"),
    searchYouTubeShorts: vi.fn(async (_apiKey: string, query: string) => {
      searchCalls.push(query);
      return [];
    }),
    formatYouTubeData: vi.fn(() => "formatted yt data"),
  };
});

vi.mock("@workspace/integrations-anthropic-ai", () => {
  function streamFor(systemPrompt: string) {
    let text = "OK";
    if (systemPrompt.startsWith("You are the GrowthStack Clip Discovery agent")) {
      text = DISCOVERY_OUTPUT;
    } else if (
      systemPrompt.startsWith("You are the GrowthStack competitive research")
    ) {
      text = "## TOPIC CLUSTER\nonboarding\n";
    } else if (systemPrompt.startsWith("You are the GrowthStack clip surgery")) {
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

// Avoid extra DB churn from constraint/CI history lookups.
vi.mock("../lib/pipeline/constraint-history", () => ({
  fetchConstraintHistory: vi.fn(async () => ({ totalRuns: 0 })),
  formatHistoricalContext: vi.fn(() => null),
}));
vi.mock("../lib/competitive-intel/historical-context", () => ({
  getHistoricalContext: vi.fn(async () => ""),
}));

const { db, episodesTable, pipelineRunsTable } = await import("@workspace/db");
const { eq } = await import("drizzle-orm");
const { runClipPipeline } = await import("../lib/pipeline/orchestrator");
const youtubeMod = await import("../lib/pipeline/youtube");
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
}

const createdEpisodeIds: number[] = [];
const createdRunIds: number[] = [];

afterAll(async () => {
  for (const id of createdRunIds) {
    await db.delete(pipelineRunsTable).where(eq(pipelineRunsTable.id, id));
  }
  for (const id of createdEpisodeIds) {
    await db.delete(episodesTable).where(eq(episodesTable.id, id));
  }
});

async function createTestEpisode(): Promise<number> {
  const fullTranscript =
    "This is a long enough transcript about SaaS onboarding and activation. ".repeat(
      10,
    );
  const res = await request(app)
    .post("/api/episodes")
    .send({
      episodeName: "Test Discovery Episode",
      guestName: "Test Guest",
      fullTranscript,
    });
  expect(res.status).toBe(201);
  const id = res.body.id as number;
  createdEpisodeIds.push(id);
  return id;
}

describe("Discover Clips end-to-end", () => {
  it("POST /api/episodes/:id/discover-clips stores the discovery output", async () => {
    const episodeId = await createTestEpisode();

    const res = await request(app)
      .post(`/api/episodes/${episodeId}/discover-clips`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.episodeId).toBe(episodeId);
    expect(res.body.discoveryOutput).toContain("## CLIP 1");
    expect(res.body.discoveryOutput).toContain("## DISCOVERY SUMMARY");

    const [episode] = await db
      .select()
      .from(episodesTable)
      .where(eq(episodesTable.id, episodeId));
    expect(episode.discoveryOutput).toBeTruthy();
    expect(episode.discoveryOutput).toContain("## CLIP 1");
  });

  it("Analyze-This-Clip flow persists suggestedTopicKeywords and uses them in the pipeline", async () => {
    const episodeId = await createTestEpisode();

    // Step 1: discover clips so we have a discovery output to source keywords from.
    const discoverRes = await request(app)
      .post(`/api/episodes/${episodeId}/discover-clips`)
      .send();
    expect(discoverRes.status).toBe(200);

    // Step 2: simulate the frontend "Analyze This Clip" handler — POST
    // /api/pipeline/runs with the discovered clip's topicKeywords forwarded as
    // suggestedTopicKeywords, plus the episodeId.
    const suggestedKeywords = "saas onboarding activation churn";
    const clipTranscript =
      "Speaker 1: Onboarding is where most SaaS products lose their users in week one.";

    const createRes = await request(app)
      .post("/api/pipeline/runs")
      .send({
        type: "clip",
        clipType: "vertical",
        clipTranscript,
        episodeId,
        suggestedTopicKeywords: suggestedKeywords,
      });

    expect(createRes.status).toBe(201);
    const runId = createRes.body.id as number;
    createdRunIds.push(runId);

    // The persisted row must carry suggested_topic_keywords through.
    const [stored] = await db
      .select()
      .from(pipelineRunsTable)
      .where(eq(pipelineRunsTable.id, runId));
    expect(stored.suggestedTopicKeywords).toBe(suggestedKeywords);
    expect(stored.episodeId).toBe(episodeId);

    // Step 3: run the orchestrator directly (the SSE /stream route invokes it
    // the same way). Reset the call tracker so we only see calls from this run.
    searchCalls.length = 0;
    const extractSpy = vi.mocked(youtubeMod.extractTopicKeywords);
    extractSpy.mockClear();

    const res = new FakeRes();
    await runClipPipeline(
      runId,
      stored.episodeTranscript,
      stored.clipTranscript || "",
      stored.clipType || "vertical",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      res as any,
      stored.suggestedTopicKeywords || undefined,
    );

    // YouTube search must be driven by the override keywords, NOT by anything
    // extracted from the clip transcript.
    expect(searchCalls.length).toBeGreaterThan(0);
    expect(searchCalls[0]).toBe(`${suggestedKeywords} marketing`);
    for (const q of searchCalls) {
      expect(q).not.toContain("EXTRACTED_FROM_TRANSCRIPT");
    }

    // extractTopicKeywords must be bypassed entirely when suggested keywords
    // are present — every call site in runClipPipeline uses
    // `overrideKeywords ?? extractTopicKeywords(...)`.
    expect(extractSpy).not.toHaveBeenCalled();
  });
});
