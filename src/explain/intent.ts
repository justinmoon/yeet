import path from "node:path";
import { z } from "zod";
import type { ExplainIntent, ExplainRequest } from "./types";

const requestSchema = z.object({
  prompt: z.string().min(1),
  cwd: z.string().min(1),
  base: z.string().min(1),
  head: z.string().min(1),
  includePath: z.string().optional(),
});

export function normalizeRequest(payload: ExplainRequest): ExplainIntent {
  const parsed = requestSchema.parse(payload);
  return {
    prompt: parsed.prompt,
    cwd: path.resolve(parsed.cwd),
    base: parsed.base,
    head: parsed.head,
    includePath: parsed.includePath,
  } satisfies ExplainIntent;
}
