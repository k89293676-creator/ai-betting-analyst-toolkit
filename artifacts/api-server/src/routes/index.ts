import { Router, type IRouter } from "express";
import healthRouter from "./health";
import predictionsRouter from "./predictions";
import oddsRouter from "./odds";
import telegramRouter from "./telegram";
import metricsRouter from "./metrics";
import trainingRouter from "./training";
import geminiRouter from "./gemini";

const router: IRouter = Router();

router.use(healthRouter);
router.use(predictionsRouter);
router.use(oddsRouter);
router.use(telegramRouter);
router.use(metricsRouter);
router.use(trainingRouter);
router.use(geminiRouter);

export default router;
