import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pipelineRouter from "./pipeline";
import episodesRouter from "./episodes";
import competitiveIntelligenceRouter from "./competitive-intelligence";

const router: IRouter = Router();

router.use(healthRouter);
router.use(episodesRouter);
router.use(pipelineRouter);
router.use(competitiveIntelligenceRouter);

export default router;
