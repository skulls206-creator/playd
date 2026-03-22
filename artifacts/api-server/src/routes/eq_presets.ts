import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, eqPresetsTable } from "@workspace/db";
import {
  CreateEqPresetBody,
  UpdateEqPresetBody,
  UpdateEqPresetParams,
  DeleteEqPresetParams,
  SetActiveEqPresetBody,
  ListEqPresetsResponse,
  SetActiveEqPresetResponse,
  UpdateEqPresetResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/eq-presets", requireAuth, async (req, res): Promise<void> => {
  const presets = await db.select().from(eqPresetsTable).where(eq(eqPresetsTable.userId, req.userId!)).orderBy(eqPresetsTable.createdAt);
  res.json(ListEqPresetsResponse.parse(presets));
});

router.post("/eq-presets", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateEqPresetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [preset] = await db.insert(eqPresetsTable).values({ ...parsed.data, isBuiltin: false, userId: req.userId! }).returning();
  res.status(201).json(preset);
});

router.put("/eq-presets/active", requireAuth, async (req, res): Promise<void> => {
  const parsed = SetActiveEqPresetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = req.userId!;

  await db.update(eqPresetsTable).set({ isActive: false }).where(eq(eqPresetsTable.userId, userId));

  if (parsed.data.presetId !== null && parsed.data.presetId !== undefined) {
    const [preset] = await db
      .update(eqPresetsTable)
      .set({ isActive: true })
      .where(and(eq(eqPresetsTable.id, parsed.data.presetId), eq(eqPresetsTable.userId, userId)))
      .returning();

    if (!preset) {
      res.status(404).json({ error: "Preset not found" });
      return;
    }
    res.json(SetActiveEqPresetResponse.parse(preset));
    return;
  }

  const presets = await db.select().from(eqPresetsTable).where(eq(eqPresetsTable.userId, userId)).limit(1);
  res.json(SetActiveEqPresetResponse.parse(presets[0] ?? { id: 0, name: "None", bands: "[]", isActive: false, isBuiltin: false, createdAt: new Date(), updatedAt: new Date(), userId }));
});

router.patch("/eq-presets/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateEqPresetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateEqPresetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [preset] = await db
    .update(eqPresetsTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(eqPresetsTable.id, params.data.id), eq(eqPresetsTable.userId, req.userId!)))
    .returning();
  if (!preset) {
    res.status(404).json({ error: "Preset not found" });
    return;
  }
  res.json(UpdateEqPresetResponse.parse(preset));
});

router.delete("/eq-presets/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteEqPresetParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(eqPresetsTable).where(and(eq(eqPresetsTable.id, params.data.id), eq(eqPresetsTable.userId, req.userId!)));
  res.sendStatus(204);
});

export default router;
