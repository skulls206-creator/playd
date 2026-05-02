import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tracksRouter from "./tracks";
import playlistsRouter from "./playlists";
import queueRouter from "./queue";
import eqPresetsRouter from "./eq_presets";
import authRouter from "./auth";
import vaultRouter from "./vault";
import ytRouter from "./yt";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(tracksRouter);
router.use(playlistsRouter);
router.use(queueRouter);
router.use(eqPresetsRouter);
router.use(vaultRouter);
router.use(ytRouter);

export default router;
