import { describe, expect, test } from "bun:test";
import type { StyledText } from "@opentui/core";
import {
  createOrchestrationUIState,
  reduceOrchestrationUIState,
  DEFAULT_ORCHESTRATION_UI_STATE,
  type OrchestrationUIState,
  type OrchestrationUIEvent,
} from "../../src/plan/ui-state";
import {
  formatOrchestrationStatus,
  createOrchestrationStatusText,
  formatAgentPrefix,
  formatAgentMessage,
  formatAgentToolCall,
  formatAskUserPrompt,
  formatStepHeader,
  formatStepApproved,
  formatChangeRequest,
  formatLoopGuardWarning,
  formatError,
  formatOrchestrationStarted,
  formatOrchestrationComplete,
  formatAgentTransition,
  orchestrationColors,
} from "../../src/plan/ui-renderer";

/**
 * Helper to extract plain text content from StyledText.
 * @opentui StyledText can be:
 * - A string
 * - A chunk object with { __isChunk: true, text: string, ... }
 * - A template result with { chunks: [chunk, ...] }
 * - An array of the above
 */
function toPlainText(styled: StyledText): string {
  if (typeof styled === "string") {
    return styled;
  }
  if (Array.isArray(styled)) {
    return styled.map(toPlainText).join("");
  }
  if (styled && typeof styled === "object") {
    // Handle template tag results with chunks array
    if ("chunks" in styled && Array.isArray((styled as { chunks: unknown[] }).chunks)) {
      return (styled as { chunks: StyledText[] }).chunks.map(toPlainText).join("");
    }
    // Handle @opentui chunk objects
    if ("__isChunk" in styled && "text" in styled) {
      return String((styled as { text: string }).text);
    }
    // Handle children property
    if ("children" in styled && styled.children !== undefined) {
      return toPlainText(styled.children as StyledText);
    }
  }
  return "";
}

describe("OrchestrationUIState", () => {
  describe("createOrchestrationUIState", () => {
    test("creates initial state with defaults", () => {
      const state = createOrchestrationUIState();

      expect(state.active).toBe(true);
      expect(state.flowState).toBe("coder_active");
      expect(state.activeAgent).toBe("coder");
      expect(state.activeStep).toBe("1");
      expect(state.changeRequestCount).toBe(0);
      expect(state.awaitingUser).toBe(false);
    });

    test("accepts custom planPath and activeStep", () => {
      const state = createOrchestrationUIState(
        "docs/feature/plan.md",
        "step-5",
        10,
      );

      expect(state.planPath).toBe("docs/feature/plan.md");
      expect(state.activeStep).toBe("step-5");
      expect(state.totalSteps).toBe(10);
    });
  });

  describe("reduceOrchestrationUIState", () => {
    test("activate event initializes state", () => {
      const state = DEFAULT_ORCHESTRATION_UI_STATE;
      const event: OrchestrationUIEvent = {
        type: "activate",
        planPath: "docs/test/plan.md",
        activeStep: "1",
        totalSteps: 5,
      };

      const newState = reduceOrchestrationUIState(state, event);

      expect(newState.active).toBe(true);
      expect(newState.planPath).toBe("docs/test/plan.md");
      expect(newState.activeStep).toBe("1");
      expect(newState.totalSteps).toBe(5);
      expect(newState.activeAgent).toBe("coder");
    });

    test("deactivate event clears active state", () => {
      const state = createOrchestrationUIState();
      const event: OrchestrationUIEvent = { type: "deactivate" };

      const newState = reduceOrchestrationUIState(state, event);

      expect(newState.active).toBe(false);
      expect(newState.activeAgent).toBe(null);
    });

    test("agent_changed event updates active agent", () => {
      const state = createOrchestrationUIState();
      const event: OrchestrationUIEvent = {
        type: "agent_changed",
        agent: "reviewer",
      };

      const newState = reduceOrchestrationUIState(state, event);

      expect(newState.activeAgent).toBe("reviewer");
      expect(newState.flowState).toBe("reviewer_active");
    });

    test("step_changed event updates step and resets counter", () => {
      let state = createOrchestrationUIState();
      state = { ...state, changeRequestCount: 3 };

      const event: OrchestrationUIEvent = {
        type: "step_changed",
        step: "3",
        totalSteps: 5,
      };

      const newState = reduceOrchestrationUIState(state, event);

      expect(newState.activeStep).toBe("3");
      expect(newState.totalSteps).toBe(5);
      expect(newState.changeRequestCount).toBe(0);
    });

    test("change_request event updates counter", () => {
      const state = createOrchestrationUIState();
      const event: OrchestrationUIEvent = {
        type: "change_request",
        count: 2,
      };

      const newState = reduceOrchestrationUIState(state, event);

      expect(newState.changeRequestCount).toBe(2);
    });

    test("awaiting_user event sets blocking state", () => {
      const state = createOrchestrationUIState();
      const event: OrchestrationUIEvent = {
        type: "awaiting_user",
        prompt: "Which approach?",
      };

      const newState = reduceOrchestrationUIState(state, event);

      expect(newState.flowState).toBe("awaiting_user_input");
      expect(newState.awaitingUser).toBe(true);
      expect(newState.userPrompt).toBe("Which approach?");
    });

    test("user_replied event clears blocking state", () => {
      let state = createOrchestrationUIState();
      state = reduceOrchestrationUIState(state, {
        type: "awaiting_user",
        prompt: "Question?",
      });

      const newState = reduceOrchestrationUIState(state, {
        type: "user_replied",
      });

      expect(newState.awaitingUser).toBe(false);
      expect(newState.userPrompt).toBeUndefined();
    });

    test("error event sets error state", () => {
      const state = createOrchestrationUIState();
      const event: OrchestrationUIEvent = {
        type: "error",
        message: "API timeout",
      };

      const newState = reduceOrchestrationUIState(state, event);

      expect(newState.flowState).toBe("error");
      expect(newState.errorMessage).toBe("API timeout");
    });

    test("error_cleared event restores previous agent state", () => {
      let state = createOrchestrationUIState();
      state = reduceOrchestrationUIState(state, {
        type: "agent_changed",
        agent: "reviewer",
      });
      state = reduceOrchestrationUIState(state, {
        type: "error",
        message: "Error",
      });

      const newState = reduceOrchestrationUIState(state, {
        type: "error_cleared",
      });

      expect(newState.flowState).toBe("reviewer_active");
      expect(newState.errorMessage).toBeUndefined();
    });
  });
});

describe("Orchestration UI Renderer", () => {
  describe("formatOrchestrationStatus", () => {
    test("returns empty string when not active", () => {
      const state: OrchestrationUIState = {
        ...DEFAULT_ORCHESTRATION_UI_STATE,
        active: false,
      };

      expect(formatOrchestrationStatus(state)).toBe("");
    });

    test("formats coder active state", () => {
      const state = createOrchestrationUIState("plan.md", "2", 5);

      const status = formatOrchestrationStatus(state);

      expect(status).toContain("Coder");
      expect(status).toContain("Step 2/5");
    });

    test("formats reviewer active state", () => {
      let state = createOrchestrationUIState("plan.md", "2", 5);
      state = reduceOrchestrationUIState(state, {
        type: "agent_changed",
        agent: "reviewer",
      });

      const status = formatOrchestrationStatus(state);

      expect(status).toContain("Reviewer");
    });

    test("shows change request count when > 0", () => {
      let state = createOrchestrationUIState();
      state = { ...state, changeRequestCount: 2 };

      const status = formatOrchestrationStatus(state);

      expect(status).toContain("Changes: 2");
    });

    test("shows waiting state when awaiting user", () => {
      let state = createOrchestrationUIState();
      state = reduceOrchestrationUIState(state, {
        type: "awaiting_user",
        prompt: "Question?",
      });

      const status = formatOrchestrationStatus(state);

      expect(status).toContain("Waiting for user");
    });

    test("shows error state", () => {
      let state = createOrchestrationUIState();
      state = reduceOrchestrationUIState(state, {
        type: "error",
        message: "Error",
      });

      const status = formatOrchestrationStatus(state);

      expect(status).toContain("Error");
    });
  });

  // Note: Tests for StyledText formatting functions (formatAgentPrefix, formatAgentMessage,
  // formatAgentToolCall, formatAskUserPrompt, formatStepHeader, etc.) are omitted because
  // they return @opentui StyledText objects designed for TUI rendering, not plain strings.
  // These functions are tested via manual TUI testing and integration tests.

  describe("createOrchestrationStatusText", () => {
    test("combines model info with orchestration status", () => {
      const state = createOrchestrationUIState("plan.md", "2", 5);

      const text = createOrchestrationStatusText(state, "Claude 3.5 Sonnet");

      expect(text).toContain("Claude 3.5 Sonnet");
      expect(text).toContain("Coder");
      expect(text).toContain("Step 2/5");
    });

    test("returns only orchestration status when no model info", () => {
      const state = createOrchestrationUIState("plan.md", "2");

      const text = createOrchestrationStatusText(state);

      expect(text).toContain("Coder");
      expect(text).toContain("Step 2");
    });

    test("returns only model info when orchestration inactive", () => {
      const state: OrchestrationUIState = {
        ...DEFAULT_ORCHESTRATION_UI_STATE,
        active: false,
      };

      const text = createOrchestrationStatusText(state, "Claude 3.5 Sonnet");

      expect(text).toBe("Claude 3.5 Sonnet");
    });
  });
});

describe("UI State Transitions", () => {
  test("full orchestration flow state transitions", () => {
    let state: OrchestrationUIState = DEFAULT_ORCHESTRATION_UI_STATE;

    // Activate orchestration
    state = reduceOrchestrationUIState(state, {
      type: "activate",
      planPath: "docs/feature/plan.md",
      activeStep: "1",
      totalSteps: 3,
    });
    expect(state.active).toBe(true);
    expect(state.activeAgent).toBe("coder");

    // Coder requests review
    state = reduceOrchestrationUIState(state, {
      type: "agent_changed",
      agent: "reviewer",
    });
    expect(state.activeAgent).toBe("reviewer");
    expect(state.flowState).toBe("reviewer_active");

    // Reviewer requests changes
    state = reduceOrchestrationUIState(state, {
      type: "change_request",
      count: 1,
    });
    state = reduceOrchestrationUIState(state, {
      type: "agent_changed",
      agent: "coder",
    });
    expect(state.activeAgent).toBe("coder");
    expect(state.changeRequestCount).toBe(1);

    // Coder requests review again
    state = reduceOrchestrationUIState(state, {
      type: "agent_changed",
      agent: "reviewer",
    });

    // Reviewer approves
    state = reduceOrchestrationUIState(state, {
      type: "step_changed",
      step: "2",
    });
    state = reduceOrchestrationUIState(state, {
      type: "agent_changed",
      agent: "coder",
    });
    expect(state.activeStep).toBe("2");
    expect(state.changeRequestCount).toBe(0); // Reset on step change
  });

  test("ask-user flow", () => {
    let state = createOrchestrationUIState();

    // Agent asks user
    state = reduceOrchestrationUIState(state, {
      type: "awaiting_user",
      prompt: "Which database?",
    });

    expect(state.awaitingUser).toBe(true);
    expect(state.userPrompt).toBe("Which database?");
    expect(formatOrchestrationStatus(state)).toContain("Waiting for user");

    // User replies
    state = reduceOrchestrationUIState(state, { type: "user_replied" });

    expect(state.awaitingUser).toBe(false);
    expect(state.userPrompt).toBeUndefined();
  });
});

describe("StyledText Formatting Functions", () => {
  describe("formatAgentPrefix", () => {
    test("formats coder prefix", () => {
      const result = formatAgentPrefix("coder");
      const text = toPlainText(result);

      expect(text).toContain("[coder]");
    });

    test("formats reviewer prefix", () => {
      const result = formatAgentPrefix("reviewer");
      const text = toPlainText(result);

      expect(text).toContain("[reviewer]");
    });

    test("includes tool name when provided", () => {
      const result = formatAgentPrefix("coder", "edit");
      const text = toPlainText(result);

      expect(text).toContain("[coder:edit]");
    });

    test("includes tool name for reviewer", () => {
      const result = formatAgentPrefix("reviewer", "bash");
      const text = toPlainText(result);

      expect(text).toContain("[reviewer:bash]");
    });
  });

  describe("formatAgentMessage", () => {
    test("formats coder message with prefix", () => {
      const result = formatAgentMessage("coder", "Starting implementation...");
      const text = toPlainText(result);

      expect(text).toContain("[coder]");
      expect(text).toContain("Starting implementation...");
    });

    test("formats reviewer message with prefix", () => {
      const result = formatAgentMessage("reviewer", "Reviewing changes...");
      const text = toPlainText(result);

      expect(text).toContain("[reviewer]");
      expect(text).toContain("Reviewing changes...");
    });
  });

  describe("formatAgentToolCall", () => {
    test("formats tool call with agent and tool name prefix", () => {
      const result = formatAgentToolCall("coder", "edit", "src/main.ts +10/-2");
      const text = toPlainText(result);

      expect(text).toContain("[coder:edit]");
      expect(text).toContain("src/main.ts +10/-2");
    });

    test("formats reviewer tool call", () => {
      const result = formatAgentToolCall("reviewer", "bash", "npm test");
      const text = toPlainText(result);

      expect(text).toContain("[reviewer:bash]");
      expect(text).toContain("npm test");
    });
  });

  describe("formatAskUserPrompt", () => {
    test("formats ask-user prompt with coder requester", () => {
      const result = formatAskUserPrompt("coder", "Which approach should I use?");
      const text = toPlainText(result);

      expect(text).toContain("[coder]");
      expect(text).toContain("Question");
      expect(text).toContain("Which approach should I use?");
      expect(text).toContain("Waiting for your response");
    });

    test("formats ask-user prompt with reviewer requester", () => {
      const result = formatAskUserPrompt("reviewer", "Should I approve this?");
      const text = toPlainText(result);

      expect(text).toContain("[reviewer]");
      expect(text).toContain("Should I approve this?");
    });

    test("formats ask-user prompt with undefined requester", () => {
      const result = formatAskUserPrompt(undefined, "General question");
      const text = toPlainText(result);

      expect(text).toContain("[agent]");
      expect(text).toContain("General question");
    });
  });

  describe("formatStepHeader", () => {
    test("formats step header with step ID only", () => {
      const result = formatStepHeader("2");
      const text = toPlainText(result);

      expect(text).toContain("Step 2");
      expect(text).toContain("═══");
    });

    test("formats step header with total steps", () => {
      const result = formatStepHeader("2", undefined, 5);
      const text = toPlainText(result);

      expect(text).toContain("Step 2/5");
    });

    test("includes step content when provided", () => {
      const result = formatStepHeader("1", "Implement authentication", 3);
      const text = toPlainText(result);

      expect(text).toContain("Step 1/3");
      expect(text).toContain("Implement authentication");
    });

    test("truncates long step content", () => {
      const longContent = "A".repeat(100);
      const result = formatStepHeader("1", longContent);
      const text = toPlainText(result);

      // Should be truncated with ellipsis
      expect(text).toContain("...");
      expect(text.length).toBeLessThan(longContent.length + 50);
    });
  });

  describe("formatStepApproved", () => {
    test("formats step approval message", () => {
      const result = formatStepApproved("2");
      const text = toPlainText(result);

      expect(text).toContain("✓");
      expect(text).toContain("Step 2");
      expect(text).toContain("approved");
    });
  });

  describe("formatChangeRequest", () => {
    test("formats change request with count and reason", () => {
      const result = formatChangeRequest("Fix the bug in line 42", 2, 3);
      const text = toPlainText(result);

      expect(text).toContain("↩");
      expect(text).toContain("Changes requested");
      expect(text).toContain("2/3");
      expect(text).toContain("Fix the bug in line 42");
    });
  });

  describe("formatLoopGuardWarning", () => {
    test("formats loop guard warning with step and count", () => {
      const result = formatLoopGuardWarning("2", 4);
      const text = toPlainText(result);

      expect(text).toContain("⚠️");
      expect(text).toContain("Loop guard triggered");
      expect(text).toContain("4");
      expect(text).toContain("step 2");
      expect(text).toContain("User intervention required");
    });
  });

  describe("formatError", () => {
    test("formats error message", () => {
      const result = formatError("API timeout");
      const text = toPlainText(result);

      expect(text).toContain("❌");
      expect(text).toContain("Error");
      expect(text).toContain("API timeout");
    });
  });

  describe("formatOrchestrationStarted", () => {
    test("formats orchestration start message", () => {
      const result = formatOrchestrationStarted("docs/feature/plan.md", "1");
      const text = toPlainText(result);

      expect(text).toContain("🎭");
      expect(text).toContain("Orchestration started");
      expect(text).toContain("docs/feature/plan.md");
      expect(text).toContain("Step 1");
    });
  });

  describe("formatOrchestrationComplete", () => {
    test("formats completion message", () => {
      const result = formatOrchestrationComplete();
      const text = toPlainText(result);

      expect(text).toContain("🎉");
      expect(text).toContain("All steps completed");
    });
  });

  describe("formatAgentTransition", () => {
    test("formats transition to coder", () => {
      const result = formatAgentTransition("reviewer", "coder");
      const text = toPlainText(result);

      expect(text).toContain("→");
      expect(text).toContain("Coder");
      expect(text).toContain("🔨");
    });

    test("formats transition to reviewer", () => {
      const result = formatAgentTransition("coder", "reviewer");
      const text = toPlainText(result);

      expect(text).toContain("→");
      expect(text).toContain("Reviewer");
      expect(text).toContain("👀");
    });

    test("handles null fromAgent", () => {
      const result = formatAgentTransition(null, "coder");
      const text = toPlainText(result);

      expect(text).toContain("Coder");
    });
  });

  describe("orchestrationColors", () => {
    test("coder color function exists and is callable", () => {
      const colorFn = orchestrationColors.coder();
      expect(typeof colorFn).toBe("function");

      // Apply color to text
      const result = colorFn("test");
      expect(result).toBeDefined();
    });

    test("reviewer color function exists and is callable", () => {
      const colorFn = orchestrationColors.reviewer();
      expect(typeof colorFn).toBe("function");
    });

    test("step color function exists and is callable", () => {
      const colorFn = orchestrationColors.step();
      expect(typeof colorFn).toBe("function");
    });

    test("blocked color function exists and is callable", () => {
      const colorFn = orchestrationColors.blocked();
      expect(typeof colorFn).toBe("function");
    });

    test("error color function exists and is callable", () => {
      const colorFn = orchestrationColors.error();
      expect(typeof colorFn).toBe("function");
    });
  });
});
