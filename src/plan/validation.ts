/**
 * Validation for plan.md and spec.md files.
 *
 * Runs on writes to docs/<slug>/spec.md or plan frontmatter.
 * Emits clear fix-it messages for the active agent on failure.
 */

import { z } from "zod";
import { parsePlan, ParseError } from "./parser";
import type { ValidationError, ValidationResult } from "./types";

/**
 * Zod schema for plan frontmatter validation.
 */
export const PlanFrontmatterSchema = z.object({
  active_step: z
    .string()
    .min(1, "active_step cannot be empty")
    .describe("The current active step identifier"),
});

/**
 * Validate plan.md file content.
 *
 * Checks:
 * - Frontmatter is parseable
 * - active_step is present and non-empty (or uses default)
 *
 * @param content - Raw file content to validate
 * @returns ValidationResult with errors and fix-it instructions
 */
export function validatePlanContent(content: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Try to parse the content
  let parsed;
  try {
    parsed = parsePlan(content);
  } catch (error) {
    if (error instanceof ParseError) {
      errors.push({
        field: "frontmatter",
        message: error.message,
        fixIt: formatFrontmatterFixIt(error.message),
      });
      return { valid: false, errors };
    }
    throw error;
  }

  // Validate frontmatter schema
  const result = PlanFrontmatterSchema.safeParse(parsed.frontmatter);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        field: issue.path.join(".") || "frontmatter",
        message: issue.message,
        fixIt: formatSchemaFixIt(issue),
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate spec.md file content.
 *
 * Spec files have simpler requirements - just check for basic structure.
 * Returns validation result with errors if issues found.
 *
 * @param content - Raw file content to validate
 */
export function validateSpecContent(content: string): ValidationResult {
  const errors: ValidationError[] = [];

  // Spec files should have some content
  if (!content.trim()) {
    errors.push({
      field: "content",
      message: "Spec file is empty",
      fixIt: "Add content to the spec.md file describing the feature specification.",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format a fix-it message for frontmatter parsing errors.
 */
function formatFrontmatterFixIt(errorMessage: string): string {
  if (errorMessage.includes("missing closing '---' delimiter")) {
    return `Fix the frontmatter format. The file should start with:

---
active_step: "1"
---

Your plan content here...`;
  }

  if (errorMessage.includes("expected 'key: value' format")) {
    return `Fix the YAML syntax in frontmatter. Each line should be 'key: value' format:

---
active_step: "1"
---`;
  }

  return `Fix the frontmatter syntax. Expected format:

---
active_step: "1"
---

Your plan content here...`;
}

/**
 * Format a fix-it message for Zod schema validation errors.
 */
function formatSchemaFixIt(issue: z.ZodIssue): string {
  const field = issue.path.join(".");

  if (field === "active_step") {
    if (issue.code === "too_small") {
      return `Set active_step to a non-empty value in frontmatter:

---
active_step: "1"
---`;
    }
  }

  return `Fix the '${field}' field in frontmatter. ${issue.message}`;
}

/**
 * Format validation errors as a message for the active agent.
 *
 * @param errors - Array of validation errors
 * @returns Formatted message with all errors and fix-it instructions
 */
export function formatValidationMessage(errors: ValidationError[]): string {
  if (errors.length === 0) {
    return "";
  }

  const header =
    "⚠️ Plan validation failed. Please fix the following issues:\n\n";

  const errorMessages = errors
    .map((err, i) => {
      return `${i + 1}. **${err.field}**: ${err.message}\n\n   Fix: ${err.fixIt}`;
    })
    .join("\n\n");

  return header + errorMessages;
}
