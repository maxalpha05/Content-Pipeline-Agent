import { Router, type IRouter } from "express";
import { GetConstraintHistoryQueryParams } from "@workspace/api-zod";
import { fetchConstraintHistory } from "../../lib/pipeline/constraint-history";

const router: IRouter = Router();

router.get("/constraints/history", async (req, res): Promise<void> => {
  const parsed = GetConstraintHistoryQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { episodeId, topic, clipType, limit } = parsed.data;
  const history = await fetchConstraintHistory({
    episodeId: typeof episodeId === "number" ? episodeId : undefined,
    topic: topic || undefined,
    clipType: clipType ?? undefined,
    limit: typeof limit === "number" ? limit : undefined,
  });
  res.json(history);
});

export default router;
