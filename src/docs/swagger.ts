/**
 * AstraOS — Swagger UI Setup
 * Serves OpenAPI 3.1 spec at /docs via swagger-ui-express.
 */

import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";

export function createSwaggerRouter(): Router {
  const router = Router();

  // Resolve YAML from src/ (dev) or dist/ (prod — copied by build script)
  let specPath = path.join(__dirname, "openapi.yaml");
  if (!fs.existsSync(specPath)) {
    specPath = path.resolve(__dirname, "../../src/docs/openapi.yaml");
  }
  const specContent = fs.readFileSync(specPath, "utf-8");
  const spec = yaml.load(specContent) as Record<string, unknown>;

  router.use("/", swaggerUi.serve);
  router.get("/", swaggerUi.setup(spec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "AstraOS API Docs",
  }));

  // Serve raw spec as JSON
  router.get("/openapi.json", (_, res) => {
    res.json(spec);
  });

  return router;
}
