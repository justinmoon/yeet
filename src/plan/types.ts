/**
 * Types for plan state management in coder/reviewer orchestration.
 *
 * Plan files use minimal YAML frontmatter with an `active_step` field.
 * The body contains human-readable plan content (steps, acceptance criteria).
 */

/**
 * Parsed frontmatter from a plan.md file.
 * Only `active_step` is supported; additional fields are ignored.
 */
export interface PlanFrontmatter {
  active_step: string;
}

/**
 * Complete parsed plan including frontmatter and body content.
 */
export interface ParsedPlan {
  frontmatter: PlanFrontmatter;
  body: string;
}

/**
 * Result of validating a plan file.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
  fixIt: string; // Clear instruction for the agent to fix the issue
}

/**
 * Default value for active_step when not specified in frontmatter.
 */
export const DEFAULT_ACTIVE_STEP = "1";
