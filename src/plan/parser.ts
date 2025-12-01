/**
 * Parser for plan.md frontmatter and body content.
 *
 * Handles YAML frontmatter extraction and simple key-value parsing.
 * Only supports the `active_step` field; other fields are preserved but ignored.
 */

import {
  DEFAULT_ACTIVE_STEP,
  type ParsedPlan,
  type PlanFrontmatter,
} from "./types";

// Matches frontmatter: ---\n<yaml>\n---<body>
// Body capture includes everything after closing ---, preserving any newlines
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)---([\s\S]*)$/;

/**
 * Parse a plan.md file content into frontmatter and body.
 *
 * Handles:
 * - Files with valid frontmatter
 * - Files with missing frontmatter (uses defaults)
 * - Files with empty frontmatter (uses defaults)
 * - Malformed YAML (throws ParseError)
 */
export function parsePlan(content: string): ParsedPlan {
  // Check if content has frontmatter (allow leading whitespace for detection only)
  const trimmedForCheck = content.trimStart();
  if (!trimmedForCheck.startsWith("---")) {
    // No frontmatter - treat entire content as body, preserved exactly
    return {
      frontmatter: { active_step: DEFAULT_ACTIVE_STEP },
      body: content,
    };
  }

  // Match against original content to preserve whitespace
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    throw new ParseError(
      "Malformed frontmatter: missing closing '---' delimiter",
    );
  }

  const [, yamlContent, body] = match;
  const frontmatter = parseYamlFrontmatter(yamlContent);

  // Preserve body exactly as captured (no trimming)
  return {
    frontmatter,
    body,
  };
}

/**
 * Parse simple YAML key-value pairs from frontmatter.
 * Only extracts `active_step`; other fields are ignored.
 */
function parseYamlFrontmatter(yaml: string): PlanFrontmatter {
  const lines = yaml.split(/\r?\n/);
  let activeStep: string | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // Check for malformed lines (no colon)
    if (!trimmed.includes(":")) {
      throw new ParseError(
        `Malformed YAML: expected 'key: value' format, got '${trimmed}'`,
      );
    }

    const colonIndex = trimmed.indexOf(":");
    const key = trimmed.slice(0, colonIndex).trim();
    let value = trimmed.slice(colonIndex + 1).trim();

    // Handle quoted values
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key === "active_step") {
      activeStep = value;
    }
    // Other keys are ignored per spec
  }

  return {
    active_step: activeStep ?? DEFAULT_ACTIVE_STEP,
  };
}

/**
 * Serialize a ParsedPlan back to file content.
 * Preserves the body text exactly as provided.
 */
export function serializePlan(plan: ParsedPlan): string {
  const frontmatter = serializeFrontmatter(plan.frontmatter);
  const body = plan.body;

  // Always include frontmatter, preserve body exactly as-is
  // Body includes any leading newline from parsing, so don't add one
  return `---\n${frontmatter}---${body}`;
}

/**
 * Serialize frontmatter to YAML format.
 */
function serializeFrontmatter(frontmatter: PlanFrontmatter): string {
  return `active_step: "${frontmatter.active_step}"\n`;
}

/**
 * Error thrown when parsing fails.
 */
export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}
