import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

export async function registerUiRoutes(server: FastifyInstance): Promise<void> {
  const sourceUiRoot = join(process.cwd(), "src", "ui");
  const distUiRoot = join(__dirname, "..", "ui");
  const root = existsSync(sourceUiRoot) ? sourceUiRoot : distUiRoot;

  await server.register(fastifyStatic, {
    root,
    prefix: "/"
  });
}
