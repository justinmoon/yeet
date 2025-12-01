import { describe, expect, test } from "bun:test";

/**
 * Tests for TUI orchestration state management.
 *
 * These tests verify the orchestration state interface and step parsing
 * without requiring a full TUI renderer.
 */

describe("Orchestration state", () => {
  describe("step parsing from plan body", () => {
    test("extracts numbered steps with colon separator", () => {
      const planContent = `---
active_step: "1"
---

# Feature Plan

- Step 1: Implement greeting function
- Step 2: Add farewell function
- Step 3: Write tests
`;

      const stepMatches = planContent.matchAll(
        /(?:^|\n)[-*]?\s*Step\s+(\d+)[:\s]+([^\n]+)/gi,
      );
      const steps: Array<{ id: string; title: string }> = [];
      for (const match of stepMatches) {
        steps.push({ id: match[1], title: match[2].trim() });
      }

      expect(steps).toHaveLength(3);
      expect(steps[0]).toEqual({ id: "1", title: "Implement greeting function" });
      expect(steps[1]).toEqual({ id: "2", title: "Add farewell function" });
      expect(steps[2]).toEqual({ id: "3", title: "Write tests" });
    });

    test("extracts active_step from frontmatter", () => {
      const planContent = `---
active_step: "2"
---

# Plan content
`;

      const frontmatterMatch = planContent.match(
        /^---\s*\n[\s\S]*?active_step:\s*["']?(\d+)["']?[\s\S]*?---/,
      );
      const activeStep = frontmatterMatch?.[1] || "1";

      expect(activeStep).toBe("2");
    });

    test("defaults to step 1 when frontmatter missing", () => {
      const planContent = `# Plan without frontmatter

- Step 1: Do something
`;

      const frontmatterMatch = planContent.match(
        /^---\s*\n[\s\S]*?active_step:\s*["']?(\d+)["']?[\s\S]*?---/,
      );
      const activeStep = frontmatterMatch?.[1] || "1";

      expect(activeStep).toBe("1");
    });

    test("handles unquoted active_step value", () => {
      const planContent = `---
active_step: 3
---

# Plan
`;

      const frontmatterMatch = planContent.match(
        /^---\s*\n[\s\S]*?active_step:\s*["']?(\d+)["']?[\s\S]*?---/,
      );
      const activeStep = frontmatterMatch?.[1] || "1";

      expect(activeStep).toBe("3");
    });
  });

  describe("orchestration state interface", () => {
    test("default state is inactive", () => {
      const state = {
        active: false,
        planPath: "",
        intentPath: "",
        specPath: "",
        currentStep: "1",
        totalSteps: 0,
        activeAgent: null,
        flowState: "coder_active" as const,
        changeRequestCount: 0,
        awaitingUserPrompt: null,
        steps: [],
      };

      expect(state.active).toBe(false);
      expect(state.flowState).toBe("coder_active");
    });

    test("active state has populated fields", () => {
      const state = {
        active: true,
        planPath: "/path/to/plan.md",
        intentPath: "/path/to/intent.md",
        specPath: "/path/to/spec.md",
        currentStep: "2",
        totalSteps: 3,
        activeAgent: "reviewer" as const,
        flowState: "reviewer_active" as const,
        changeRequestCount: 1,
        awaitingUserPrompt: null,
        steps: [
          { id: "1", title: "First step" },
          { id: "2", title: "Second step" },
          { id: "3", title: "Third step" },
        ],
      };

      expect(state.active).toBe(true);
      expect(state.currentStep).toBe("2");
      expect(state.totalSteps).toBe(3);
      expect(state.activeAgent).toBe("reviewer");
      expect(state.steps).toHaveLength(3);
    });

    test("awaiting user prompt state", () => {
      const state = {
        active: true,
        planPath: "/path/to/plan.md",
        intentPath: "/path/to/intent.md",
        specPath: "/path/to/spec.md",
        currentStep: "1",
        totalSteps: 2,
        activeAgent: "coder" as const,
        flowState: "awaiting_user_input" as const,
        changeRequestCount: 3,
        awaitingUserPrompt: "Loop guard triggered: need user input",
        steps: [],
      };

      expect(state.flowState).toBe("awaiting_user_input");
      expect(state.awaitingUserPrompt).toBeTruthy();
      expect(state.changeRequestCount).toBe(3);
    });
  });
});
