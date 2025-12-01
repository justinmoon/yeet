import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  parsePlan,
  serializePlan,
  ParseError,
  loadPlan,
  savePlan,
  updatePlanFrontmatter,
  createPlan,
  LoadError,
  validatePlanContent,
  validateSpecContent,
  formatValidationMessage,
  DEFAULT_ACTIVE_STEP,
  validateOnWrite,
  shouldValidate,
  createWriteInterceptor,
} from "../../src/plan";

describe("PlanState Parsing", () => {
  describe("parsePlan", () => {
    test("parses valid frontmatter with active_step", () => {
      const content = `---
active_step: "2"
---

# My Plan

Step 1: Do something
Step 2: Do something else`;

      const result = parsePlan(content);

      expect(result.frontmatter.active_step).toBe("2");
      expect(result.body).toContain("# My Plan");
      expect(result.body).toContain("Step 1: Do something");
    });

    test("parses frontmatter with unquoted active_step", () => {
      const content = `---
active_step: 3
---

Plan content`;

      const result = parsePlan(content);
      expect(result.frontmatter.active_step).toBe("3");
    });

    test("parses frontmatter with single-quoted active_step", () => {
      const content = `---
active_step: 'step-a'
---

Plan content`;

      const result = parsePlan(content);
      expect(result.frontmatter.active_step).toBe("step-a");
    });

    test("uses default when frontmatter is missing", () => {
      const content = `# My Plan

No frontmatter here`;

      const result = parsePlan(content);

      expect(result.frontmatter.active_step).toBe(DEFAULT_ACTIVE_STEP);
      expect(result.body).toBe(content);
    });

    test("uses default when active_step is missing from frontmatter", () => {
      const content = `---
some_other_key: value
---

Plan content`;

      const result = parsePlan(content);
      expect(result.frontmatter.active_step).toBe(DEFAULT_ACTIVE_STEP);
    });

    test("uses default for empty frontmatter", () => {
      const content = `---
---

Plan content`;

      const result = parsePlan(content);
      expect(result.frontmatter.active_step).toBe(DEFAULT_ACTIVE_STEP);
    });

    test("ignores other frontmatter fields", () => {
      const content = `---
active_step: "5"
title: My Feature
author: Test User
---

Plan body`;

      const result = parsePlan(content);
      expect(result.frontmatter.active_step).toBe("5");
      // Other fields should be ignored, not cause errors
    });

    test("handles frontmatter comments", () => {
      const content = `---
# This is a comment
active_step: "1"
# Another comment
---

Body`;

      const result = parsePlan(content);
      expect(result.frontmatter.active_step).toBe("1");
    });

    test("throws ParseError for malformed frontmatter - missing closing delimiter", () => {
      const content = `---
active_step: "1"

Plan without closing delimiter`;

      expect(() => parsePlan(content)).toThrow(ParseError);
      expect(() => parsePlan(content)).toThrow(/missing closing '---' delimiter/);
    });

    test("throws ParseError for malformed YAML - no colon", () => {
      const content = `---
active_step "1"
---

Body`;

      expect(() => parsePlan(content)).toThrow(ParseError);
      expect(() => parsePlan(content)).toThrow(/expected 'key: value' format/);
    });

    test("preserves body whitespace and formatting", () => {
      const body = `
# Plan

- Step 1: First step
  - Sub-step a
  - Sub-step b

- Step 2: Second step

\`\`\`
Code block
\`\`\``;

      const content = `---
active_step: "1"
---${body}`;

      const result = parsePlan(content);
      expect(result.body).toBe(body);
    });

    test("preserves leading and trailing whitespace in body", () => {
      // Body with intentional leading blank lines and trailing newlines
      const body = "\n\n\nContent with leading blanks\n\nAnd trailing\n\n\n";

      const content = `---
active_step: "1"
---${body}`;

      const result = parsePlan(content);
      expect(result.body).toBe(body);

      // Round-trip should preserve exactly
      const serialized = serializePlan(result);
      const reparsed = parsePlan(serialized);
      expect(reparsed.body).toBe(body);
    });

    test("handles Windows line endings", () => {
      const content = "---\r\nactive_step: \"1\"\r\n---\r\n\r\nPlan content";

      const result = parsePlan(content);
      expect(result.frontmatter.active_step).toBe("1");
      // Body preserves everything after closing --- including both line endings
      expect(result.body).toBe("\r\n\r\nPlan content");
    });
  });

  describe("serializePlan", () => {
    test("serializes plan with frontmatter and body", () => {
      const plan = {
        frontmatter: { active_step: "3" },
        body: "\n# My Plan\n\nStep content here",
      };

      const result = serializePlan(plan);

      expect(result).toContain("---");
      expect(result).toContain('active_step: "3"');
      expect(result).toContain("# My Plan");
      expect(result).toContain("Step content here");
    });

    test("preserves body text exactly", () => {
      const body = `
# Feature Plan

## Step 1
Do the thing

## Step 2
Do the other thing

- Acceptance: tests pass`;

      const plan = {
        frontmatter: { active_step: "1" },
        body,
      };

      const serialized = serializePlan(plan);
      const reparsed = parsePlan(serialized);

      expect(reparsed.body).toBe(body);
    });

    test("round-trip preserves frontmatter and body", () => {
      const original = {
        frontmatter: { active_step: "step-42" },
        body: "\nComplex\n\nbody\n\nwith\nmultiple\nlines",
      };

      const serialized = serializePlan(original);
      const reparsed = parsePlan(serialized);

      expect(reparsed.frontmatter.active_step).toBe(original.frontmatter.active_step);
      expect(reparsed.body).toBe(original.body);
    });

    test("round-trip preserves body with leading/trailing whitespace", () => {
      const original = {
        frontmatter: { active_step: "1" },
        body: "\n\n  indented content  \n\ntrailing newlines\n\n",
      };

      const serialized = serializePlan(original);
      const reparsed = parsePlan(serialized);

      expect(reparsed.body).toBe(original.body);
    });
  });
});

describe("PlanState Loading", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "plan-test-"));
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe("loadPlan", () => {
    test("loads plan from file", async () => {
      const planPath = join(testDir, "plan.md");
      writeFileSync(
        planPath,
        `---
active_step: "2"
---

# Test Plan`,
      );

      const result = await loadPlan(planPath);

      expect(result.frontmatter.active_step).toBe("2");
      expect(result.body).toContain("# Test Plan");
    });

    test("applies defaults for missing frontmatter", async () => {
      const planPath = join(testDir, "plan.md");
      writeFileSync(planPath, "# Plan without frontmatter");

      const result = await loadPlan(planPath);

      expect(result.frontmatter.active_step).toBe(DEFAULT_ACTIVE_STEP);
    });

    test("throws LoadError for missing file", async () => {
      const planPath = join(testDir, "nonexistent.md");

      await expect(loadPlan(planPath)).rejects.toThrow(LoadError);
      await expect(loadPlan(planPath)).rejects.toThrow(/not found/);
    });

    test("throws LoadError for malformed file", async () => {
      const planPath = join(testDir, "plan.md");
      writeFileSync(
        planPath,
        `---
active_step "1"
---

Body`,
      );

      await expect(loadPlan(planPath)).rejects.toThrow(LoadError);
      await expect(loadPlan(planPath)).rejects.toThrow(/Failed to parse/);
    });
  });

  describe("savePlan", () => {
    test("saves plan to file", async () => {
      const planPath = join(testDir, "plan.md");
      const plan = {
        frontmatter: { active_step: "5" },
        body: "# Saved Plan\n\nContent here",
      };

      await savePlan(planPath, plan);

      const loaded = await loadPlan(planPath);
      expect(loaded.frontmatter.active_step).toBe("5");
      expect(loaded.body).toContain("# Saved Plan");
    });

    test("preserves body on save", async () => {
      const planPath = join(testDir, "plan.md");
      const body = `# Complex Plan

## Step 1: Setup
- Do X
- Do Y

## Step 2: Implementation
\`\`\`typescript
const x = 1;
\`\`\`

## Acceptance
- [ ] Tests pass
- [ ] CI green`;

      const plan = {
        frontmatter: { active_step: "1" },
        body,
      };

      await savePlan(planPath, plan);
      const loaded = await loadPlan(planPath);

      expect(loaded.body).toBe(body);
    });
  });

  describe("updatePlanFrontmatter", () => {
    test("updates active_step while preserving body", async () => {
      const planPath = join(testDir, "plan.md");
      // Body includes leading newline as it appears after ---
      const originalBody = "\n# Original body content";
      writeFileSync(
        planPath,
        `---
active_step: "1"
---${originalBody}`,
      );

      const updated = await updatePlanFrontmatter(planPath, { active_step: "2" });

      expect(updated.frontmatter.active_step).toBe("2");
      expect(updated.body).toBe(originalBody);

      // Verify persisted
      const reloaded = await loadPlan(planPath);
      expect(reloaded.frontmatter.active_step).toBe("2");
      expect(reloaded.body).toBe(originalBody);
    });

    test("preserves body with intentional whitespace through update", async () => {
      const planPath = join(testDir, "plan.md");
      const bodyWithWhitespace = "\n\n\nContent\n\n\n";
      writeFileSync(
        planPath,
        `---
active_step: "1"
---${bodyWithWhitespace}`,
      );

      await updatePlanFrontmatter(planPath, { active_step: "2" });
      const reloaded = await loadPlan(planPath);

      expect(reloaded.body).toBe(bodyWithWhitespace);
    });
  });

  describe("createPlan", () => {
    test("creates new plan with default active_step", async () => {
      const planPath = join(testDir, "new-plan.md");
      const body = "# New Plan\n\nInitial content";

      const plan = await createPlan(planPath, body);

      expect(plan.frontmatter.active_step).toBe(DEFAULT_ACTIVE_STEP);
      expect(plan.body).toBe(body);

      // Verify persisted
      const loaded = await loadPlan(planPath);
      expect(loaded.frontmatter.active_step).toBe(DEFAULT_ACTIVE_STEP);
    });

    test("creates plan with custom active_step", async () => {
      const planPath = join(testDir, "new-plan.md");

      const plan = await createPlan(planPath, "Body", "custom-step");

      expect(plan.frontmatter.active_step).toBe("custom-step");
    });
  });
});

describe("PlanState Validation", () => {
  describe("validatePlanContent", () => {
    test("returns valid for correct plan content", () => {
      const content = `---
active_step: "1"
---

# Plan`;

      const result = validatePlanContent(content);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("returns valid for plan without frontmatter (uses defaults)", () => {
      const content = "# Plan without frontmatter";

      const result = validatePlanContent(content);

      expect(result.valid).toBe(true);
    });

    test("returns errors for malformed frontmatter", () => {
      const content = `---
active_step "1"
---

Body`;

      const result = validatePlanContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0].field).toBe("frontmatter");
      expect(result.errors[0].fixIt).toBeDefined();
    });

    test("returns errors for missing closing delimiter", () => {
      const content = `---
active_step: "1"

Body without closing`;

      const result = validatePlanContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("missing closing");
    });

    test("fix-it messages are actionable", () => {
      const content = `---
active_step: "1"

Body`;

      const result = validatePlanContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors[0].fixIt).toContain("---");
      expect(result.errors[0].fixIt).toContain("active_step");
    });
  });

  describe("validateSpecContent", () => {
    test("returns valid for non-empty spec", () => {
      const result = validateSpecContent("# Spec content");

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("returns errors for empty spec", () => {
      const result = validateSpecContent("");

      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("content");
      expect(result.errors[0].fixIt).toContain("Add content");
    });

    test("returns errors for whitespace-only spec", () => {
      const result = validateSpecContent("   \n\n  ");

      expect(result.valid).toBe(false);
    });
  });

  describe("formatValidationMessage", () => {
    test("formats single error with fix-it", () => {
      const errors = [
        {
          field: "frontmatter",
          message: "Malformed YAML",
          fixIt: "Use proper YAML syntax",
        },
      ];

      const message = formatValidationMessage(errors);

      expect(message).toContain("validation failed");
      expect(message).toContain("frontmatter");
      expect(message).toContain("Malformed YAML");
      expect(message).toContain("Use proper YAML syntax");
    });

    test("formats multiple errors", () => {
      const errors = [
        { field: "field1", message: "Error 1", fixIt: "Fix 1" },
        { field: "field2", message: "Error 2", fixIt: "Fix 2" },
      ];

      const message = formatValidationMessage(errors);

      expect(message).toContain("1.");
      expect(message).toContain("2.");
      expect(message).toContain("field1");
      expect(message).toContain("field2");
    });

    test("returns empty string for no errors", () => {
      const message = formatValidationMessage([]);

      expect(message).toBe("");
    });
  });
});

describe("Defaulting Behavior", () => {
  test("DEFAULT_ACTIVE_STEP is '1'", () => {
    expect(DEFAULT_ACTIVE_STEP).toBe("1");
  });

  test("missing frontmatter defaults active_step", () => {
    const content = "No frontmatter";
    const result = parsePlan(content);
    expect(result.frontmatter.active_step).toBe("1");
  });

  test("empty frontmatter defaults active_step", () => {
    const content = "---\n---\nBody";
    const result = parsePlan(content);
    expect(result.frontmatter.active_step).toBe("1");
  });

  test("frontmatter without active_step defaults", () => {
    const content = "---\nother_field: value\n---\nBody";
    const result = parsePlan(content);
    expect(result.frontmatter.active_step).toBe("1");
  });
});

describe("Validation Hook", () => {
  describe("shouldValidate", () => {
    test("returns true for docs/<feature>/plan.md", () => {
      expect(shouldValidate("docs/auth/plan.md")).toBe(true);
      expect(shouldValidate("docs/my-feature/plan.md")).toBe(true);
      expect(shouldValidate("/abs/path/docs/orchestrate/plan.md")).toBe(true);
    });

    test("returns true for docs/<feature>/spec.md", () => {
      expect(shouldValidate("docs/auth/spec.md")).toBe(true);
      expect(shouldValidate("docs/feature-x/spec.md")).toBe(true);
    });

    test("returns false for other files", () => {
      expect(shouldValidate("src/plan.md")).toBe(false);
      expect(shouldValidate("docs/plan.md")).toBe(false);
      expect(shouldValidate("docs/feature/other.md")).toBe(false);
      expect(shouldValidate("plan.md")).toBe(false);
      expect(shouldValidate("README.md")).toBe(false);
    });
  });

  describe("validateOnWrite", () => {
    test("returns valid for non-plan/spec files", () => {
      const result = validateOnWrite("src/index.ts", "any content");
      expect(result.valid).toBe(true);
      expect(result.agentMessage).toBeUndefined();
    });

    test("returns valid for valid plan content", () => {
      const content = `---
active_step: "1"
---

# Plan`;

      const result = validateOnWrite("docs/feature/plan.md", content);
      expect(result.valid).toBe(true);
      expect(result.agentMessage).toBeUndefined();
    });

    test("returns error with agent message for invalid plan", () => {
      const content = `---
active_step "1"
---

Body`;

      const result = validateOnWrite("docs/feature/plan.md", content);
      expect(result.valid).toBe(false);
      expect(result.agentMessage).toBeDefined();
      expect(result.agentMessage).toContain("validation failed");
      expect(result.agentMessage).toContain("Fix");
    });

    test("returns valid for valid spec content", () => {
      const result = validateOnWrite("docs/feature/spec.md", "# Spec content");
      expect(result.valid).toBe(true);
    });

    test("returns error for empty spec content", () => {
      const result = validateOnWrite("docs/feature/spec.md", "");
      expect(result.valid).toBe(false);
      expect(result.agentMessage).toContain("Add content");
    });
  });

  describe("createWriteInterceptor", () => {
    test("calls error callback on validation failure", () => {
      const messages: string[] = [];
      const interceptor = createWriteInterceptor((msg) => messages.push(msg));

      const shouldProceed = interceptor("docs/feature/plan.md", `---
active_step "invalid"
---
Body`);

      expect(shouldProceed).toBe(false);
      expect(messages.length).toBe(1);
      expect(messages[0]).toContain("validation failed");
    });

    test("does not call callback on valid content", () => {
      const messages: string[] = [];
      const interceptor = createWriteInterceptor((msg) => messages.push(msg));

      const shouldProceed = interceptor("docs/feature/plan.md", `---
active_step: "1"
---
Body`);

      expect(shouldProceed).toBe(true);
      expect(messages.length).toBe(0);
    });

    test("skips validation for non-plan/spec files", () => {
      const messages: string[] = [];
      const interceptor = createWriteInterceptor((msg) => messages.push(msg));

      const shouldProceed = interceptor("src/index.ts", "malformed content");

      expect(shouldProceed).toBe(true);
      expect(messages.length).toBe(0);
    });
  });
});
