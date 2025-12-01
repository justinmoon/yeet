/**
 * Loader/saver for plan.md files with frontmatter.
 *
 * Handles reading and writing plan files while:
 * - Tolerating missing frontmatter (applies defaults)
 * - Preserving body text on save
 * - Providing clear error messages for malformed files
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ParseError, parsePlan, serializePlan } from "./parser";
import type { ParsedPlan, PlanFrontmatter } from "./types";
import { DEFAULT_ACTIVE_STEP } from "./types";

/**
 * Load a plan file from disk.
 *
 * @param path - Absolute path to the plan.md file
 * @returns ParsedPlan with frontmatter and body
 * @throws LoadError if file cannot be read or parsed
 */
export async function loadPlan(path: string): Promise<ParsedPlan> {
  if (!existsSync(path)) {
    throw new LoadError(`Plan file not found: ${path}`);
  }

  try {
    const content = await readFile(path, "utf-8");
    return parsePlan(content);
  } catch (error) {
    if (error instanceof ParseError) {
      throw new LoadError(`Failed to parse plan: ${error.message}`, error);
    }
    throw new LoadError(
      `Failed to read plan file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Save a plan to disk.
 * Preserves body text exactly as provided.
 *
 * @param path - Absolute path to the plan.md file
 * @param plan - The plan to save
 */
export async function savePlan(path: string, plan: ParsedPlan): Promise<void> {
  const content = serializePlan(plan);
  await writeFile(path, content, "utf-8");
}

/**
 * Update only the frontmatter of a plan file, preserving the body.
 *
 * @param path - Absolute path to the plan.md file
 * @param updates - Partial frontmatter updates to apply
 * @returns The updated ParsedPlan
 */
export async function updatePlanFrontmatter(
  path: string,
  updates: Partial<PlanFrontmatter>,
): Promise<ParsedPlan> {
  const plan = await loadPlan(path);

  const updatedPlan: ParsedPlan = {
    frontmatter: {
      ...plan.frontmatter,
      ...updates,
    },
    body: plan.body,
  };

  await savePlan(path, updatedPlan);
  return updatedPlan;
}

/**
 * Create a new plan file with default frontmatter.
 *
 * @param path - Absolute path for the new plan.md file
 * @param body - The plan body content
 * @param activeStep - Initial active step (defaults to "1")
 */
export async function createPlan(
  path: string,
  body: string,
  activeStep: string = DEFAULT_ACTIVE_STEP,
): Promise<ParsedPlan> {
  const plan: ParsedPlan = {
    frontmatter: { active_step: activeStep },
    body,
  };

  await savePlan(path, plan);
  return plan;
}

/**
 * Error thrown when loading fails.
 */
export class LoadError extends Error {
  cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "LoadError";
    this.cause = cause;
  }
}
