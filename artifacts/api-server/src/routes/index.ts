import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pipelineRouter from "./pipeline";
import episodesRouter from "./episodes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(episodesRouter);
router.use(pipelineRouter);

export default router;
