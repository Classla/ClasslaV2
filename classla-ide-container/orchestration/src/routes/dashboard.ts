import { Router, Request, Response } from "express";
import path from "path";
import express from "express";

const router = Router();

/**
 * GET /dashboard
 * Serve dashboard HTML/JS bundle
 */
router.use("/", express.static(path.resolve(process.cwd(), "dist/dashboard")));

// Fallback to index.html for client-side routing
router.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.resolve(process.cwd(), "dist/dashboard/index.html"));
});

export default router;
