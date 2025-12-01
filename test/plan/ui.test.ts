import { describe, expect, test } from "bun:test";
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
} from "../../src/plan/ui-renderer";

// Note: StyledText rendering functions (formatAgentPrefix, formatAgentMessage, etc.)
// produce @opentui StyledText objects that are designed for TUI rendering.
// We test the plain text functions here and rely on the TUI adapter for styled output.

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
