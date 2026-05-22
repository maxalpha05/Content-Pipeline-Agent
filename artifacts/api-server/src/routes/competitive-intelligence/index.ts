import { Router, type IRouter } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, competitiveIntelligenceTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/competitive-intelligence", async (req, res): Promise<void> => {
  const topicCluster =
    typeof req.query.topicCluster === "string" ? req.query.topicCluster : null;
  const minQualityScoreRaw =
    typeof req.query.minQualityScore === "string"
      ? parseInt(req.query.minQualityScore, 10)
      : 5;
  const minQualityScore = Number.isFinite(minQualityScoreRaw)
    ? minQualityScoreRaw
    : 5;
  const limitRaw =
    typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;

  const whereClauses = [
    gte(competitiveIntelligenceTable.dataQualityScore, minQualityScore),
  ];
  if (topicCluster) {
    whereClauses.push(eq(competitiveIntelligenceTable.topicCluster, topicCluster));
  }

  const rows = await db
    .select()
    .from(competitiveIntelligenceTable)
    .where(and(...whereClauses))
    .orderBy(desc(competitiveIntelligenceTable.createdAt))
    .limit(limit);

  res.json(rows);
});

router.get(
  "/competitive-intelligence/clusters",
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        topicCluster: competitiveIntelligenceTable.topicCluster,
        count: sql<number>`count(*)::int`,
        avgQualityScore: sql<number>`avg(${competitiveIntelligenceTable.dataQualityScore})::float`,
      })
      .from(competitiveIntelligenceTable)
      .groupBy(competitiveIntelligenceTable.topicCluster)
      .orderBy(desc(sql`count(*)`));

    res.json(rows);
  },
);

router.patch(
  "/competitive-intelligence/:pipelineRunId",
  async (req, res): Promise<void> => {
    const pipelineRunId = parseInt(req.params.pipelineRunId, 10);
    if (!Number.isFinite(pipelineRunId)) {
      res.status(400).json({ error: "Invalid pipelineRunId" });
      return;
    }

    const { userSelectedTitle, userSelectedTitleIndex } = req.body ?? {};

    if (typeof userSelectedTitle !== "string") {
      res.status(400).json({ error: "userSelectedTitle is required" });
      return;
    }
    if (
      typeof userSelectedTitleIndex !== "number" ||
      !Number.isInteger(userSelectedTitleIndex)
    ) {
      res.status(400).json({ error: "userSelectedTitleIndex must be an integer" });
      return;
    }

    const [row] = await db
      .update(competitiveIntelligenceTable)
      .set({
        userSelectedTitle,
        userSelectedTitleIndex,
      })
      .where(eq(competitiveIntelligenceTable.pipelineRunId, pipelineRunId))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Competitive intelligence record not found" });
      return;
    }

    res.json({ ok: true });
  },
);

export default router;
