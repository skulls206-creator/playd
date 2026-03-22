import { Router, type IRouter } from "express";
import healthRouter from "./health";
import tracksRouter from "./tracks";
import playlistsRouter from "./playlists";
import queueRouter from "./queue";
import eqPresetsRouter from "./eq_presets";
import subsonicRouter from "./subsonic";

const router: IRouter = Router();

router.use(healthRouter);
router.use(tracksRouter);
router.use(playlistsRouter);
router.use(queueRouter);
router.use(eqPresetsRouter);
router.use(subsonicRouter);

export default router;
