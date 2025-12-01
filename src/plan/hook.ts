/**
 * Validation hook for plan/spec file writes.
 *
 * This module provides the integration point for validating plan.md and spec.md
 * files on write operations. When validation fails, it returns an error message
 * formatted for the active agent with fix-it instructions.
 */

import { basename, dirname } from "node:path";
import {
  validatePlanContent,
  validateSpecContent,
  formatValidationMessage,
} from "./validation";
import type { ValidationResult } from "./types";

/**
 * Result of a validation hook check.
 */
export interface ValidationHookResult {
  /** Whether the write should proceed */
  valid: boolean;
  /** Message to surface to the active agent if validation failed */
  agentMessage?: string;
}

/**
 * Pattern to match docs/<feature>/plan.md or docs/<feature>/spec.md paths.
 */
const DOCS_PLAN_PATTERN = /docs\/[^/]+\/plan\.md$/;
const DOCS_SPEC_PATTERN = /docs\/[^/]+\/spec\.md$/;

/**
 * Check if a file path is a plan or spec file that should be validated.
 */
export function shouldValidate(filePath: string): boolean {
  return DOCS_PLAN_PATTERN.test(filePath) || DOCS_SPEC_PATTERN.test(filePath);
}

/**
 * Validate content being written to a plan or spec file.
 *
 * This is the main hook to call before/after writes to docs/<feature>/plan.md
 * or docs/<feature>/spec.md. On validation failure, returns a formatted message
 * that should be surfaced to the active agent.
 *
 * @param filePath - The file path being written to
 * @param content - The content being written
 * @returns ValidationHookResult with valid status and optional agent message
 *
 * @example
 * ```typescript
 * // In write tool or file watcher
 * const result = validateOnWrite(filePath, content);
 * if (!result.valid) {
 *   // Surface error to active agent
 *   emitToAgent(result.agentMessage);
 * }
 * ```
 */
export function validateOnWrite(
  filePath: string,
  content: string,
): ValidationHookResult {
  // Check if this is a file we should validate
  if (!shouldValidate(filePath)) {
    return { valid: true };
  }

  const fileName = basename(filePath);
  let result: ValidationResult;

  if (fileName === "plan.md") {
    result = validatePlanContent(content);
  } else if (fileName === "spec.md") {
    result = validateSpecContent(content);
  } else {
    // Shouldn't reach here due to shouldValidate check, but be safe
    return { valid: true };
  }

  if (result.valid) {
    return { valid: true };
  }

  // Format the error message for the agent
  const agentMessage = formatValidationMessage(result.errors);

  return {
    valid: false,
    agentMessage,
  };
}

/**
 * Create a write interceptor that validates plan/spec files.
 *
 * This returns a function that can wrap file write operations to add
 * validation. Use this to integrate validation into existing write tools.
 *
 * @param onValidationError - Callback invoked when validation fails, receives
 *                           the formatted error message to surface to the agent
 * @returns Interceptor function that validates and optionally blocks writes
 *
 * @example
 * ```typescript
 * const interceptor = createWriteInterceptor((msg) => {
 *   injectSystemMessage(msg);
 * });
 *
 * // In write tool
 * const shouldProceed = interceptor(filePath, content);
 * if (shouldProceed) {
 *   await fs.writeFile(filePath, content);
 * }
 * ```
 */
export function createWriteInterceptor(
  onValidationError: (agentMessage: string) => void,
): (filePath: string, content: string) => boolean {
  return (filePath: string, content: string): boolean => {
    const result = validateOnWrite(filePath, content);

    if (!result.valid && result.agentMessage) {
      onValidationError(result.agentMessage);
    }

    return result.valid;
  };
}
