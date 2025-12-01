import { describe, expect, test } from "bun:test";
import {
  FlowMachine,
  type FlowState,
  type FlowEvent,
  type FlowHooks,
  type FlowContext,
} from "../../src/plan";

describe("FlowMachine", () => {
  describe("initial state", () => {
    test("starts in coder_active state", () => {
      const machine = new FlowMachine();
      expect(machine.getState()).toBe("coder_active");
    });

    test("initializes with default config", () => {
      const machine = new FlowMachine();
      const context = machine.getContext();
      expect(context.activeStep).toBe("1");
      expect(context.changeRequestCount).toBe(0);
      expect(context.hasMoreSteps).toBe(true);
    });

    test("accepts custom initial config", () => {
      const machine = new FlowMachine({
        initialStep: "step-5",
        hasMoreSteps: false,
        maxChangeRequests: 5,
      });
      const context = machine.getContext();
      expect(context.activeStep).toBe("step-5");
      expect(context.hasMoreSteps).toBe(false);
    });
  });

  describe("happy path: request_review → approve", () => {
    test("coder can request review", async () => {
      const machine = new FlowMachine();

      const result = await machine.send({ type: "request_review" });

      expect(result.success).toBe(true);
      expect(result.state).toBe("reviewer_active");
      expect(machine.getState()).toBe("reviewer_active");
    });

    test("reviewer can approve and return to coder", async () => {
      const machine = new FlowMachine({ hasMoreSteps: true });
      await machine.send({ type: "request_review" });

      const result = await machine.send({ type: "approve" });

      expect(result.success).toBe(true);
      expect(result.state).toBe("coder_active");
    });

    test("full happy path cycle", async () => {
      const machine = new FlowMachine({ hasMoreSteps: true });

      // Coder works, requests review
      expect(machine.getState()).toBe("coder_active");
      await machine.send({ type: "request_review" });

      // Reviewer reviews, approves
      expect(machine.getState()).toBe("reviewer_active");
      await machine.send({ type: "approve" });

      // Back to coder for next step
      expect(machine.getState()).toBe("coder_active");

      // Advance to next step
      machine.advanceStep("2", true);
      expect(machine.getContext().activeStep).toBe("2");
      expect(machine.getChangeRequestCount()).toBe(0);
    });
  });

  describe("request_changes flow", () => {
    test("reviewer can request changes", async () => {
      const machine = new FlowMachine();
      await machine.send({ type: "request_review" });

      const result = await machine.send({
        type: "request_changes",
        reason: "Fix the bug",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("coder_active");
      expect(machine.getChangeRequestCount()).toBe(1);
    });

    test("change request count increments", async () => {
      const machine = new FlowMachine();

      // First cycle
      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Issue 1" });
      expect(machine.getChangeRequestCount()).toBe(1);

      // Second cycle
      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Issue 2" });
      expect(machine.getChangeRequestCount()).toBe(2);

      // Third cycle
      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Issue 3" });
      expect(machine.getChangeRequestCount()).toBe(3);
    });
  });

  describe("loop guard", () => {
    test("halts on 4th request_changes (default maxChangeRequests=3)", async () => {
      const machine = new FlowMachine();

      // First 3 cycles work normally
      for (let i = 0; i < 3; i++) {
        await machine.send({ type: "request_review" });
        const result = await machine.send({
          type: "request_changes",
          reason: `Issue ${i + 1}`,
        });
        expect(result.state).toBe("coder_active");
      }

      // 4th request_changes triggers loop guard
      await machine.send({ type: "request_review" });
      const result = await machine.send({
        type: "request_changes",
        reason: "Issue 4",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("awaiting_user_input");
      expect(machine.getState()).toBe("awaiting_user_input");
      expect(machine.getChangeRequestCount()).toBe(4);
    });

    test("loop guard message includes step and count", async () => {
      const machine = new FlowMachine({ initialStep: "step-3" });

      for (let i = 0; i < 3; i++) {
        await machine.send({ type: "request_review" });
        await machine.send({ type: "request_changes", reason: `Issue ${i + 1}` });
      }

      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Final issue" });

      const context = machine.getContext();
      expect(context.userPrompt).toContain("4");
      expect(context.userPrompt).toContain("step-3");
      expect(context.userPrompt).toContain("Final issue");
    });

    test("custom maxChangeRequests works", async () => {
      const machine = new FlowMachine({ maxChangeRequests: 1 });

      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Issue 1" });
      expect(machine.getState()).toBe("coder_active");

      await machine.send({ type: "request_review" });
      const result = await machine.send({
        type: "request_changes",
        reason: "Issue 2",
      });

      expect(result.state).toBe("awaiting_user_input");
    });

    test("resetLoopGuard clears counter", async () => {
      const machine = new FlowMachine();

      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Issue" });
      expect(machine.getChangeRequestCount()).toBe(1);

      machine.resetLoopGuard();
      expect(machine.getChangeRequestCount()).toBe(0);
    });

    test("advanceStep resets counter", async () => {
      const machine = new FlowMachine();

      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Issue" });
      expect(machine.getChangeRequestCount()).toBe(1);

      machine.advanceStep("2", true);
      expect(machine.getChangeRequestCount()).toBe(0);
    });
  });

  describe("ask_user / user_reply", () => {
    test("coder can ask user", async () => {
      const machine = new FlowMachine();

      const result = await machine.send({
        type: "ask_user",
        message: "Which approach should I use?",
        requester: "coder",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("awaiting_user_input");
      expect(machine.getContext().awaitingReplyFrom).toBe("coder");
      expect(machine.getContext().userPrompt).toBe("Which approach should I use?");
    });

    test("reviewer can ask user", async () => {
      const machine = new FlowMachine();
      await machine.send({ type: "request_review" });

      const result = await machine.send({
        type: "ask_user",
        message: "Is this the expected behavior?",
        requester: "reviewer",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("awaiting_user_input");
      expect(machine.getContext().awaitingReplyFrom).toBe("reviewer");
    });

    test("user_reply resumes to coder when coder asked", async () => {
      const machine = new FlowMachine();
      await machine.send({
        type: "ask_user",
        message: "Question?",
        requester: "coder",
      });

      const result = await machine.send({
        type: "user_reply",
        response: "Use approach A",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("coder_active");
    });

    test("user_reply resumes to reviewer when reviewer asked", async () => {
      const machine = new FlowMachine();
      await machine.send({ type: "request_review" });
      await machine.send({
        type: "ask_user",
        message: "Question?",
        requester: "reviewer",
      });

      const result = await machine.send({
        type: "user_reply",
        response: "Yes, that's correct",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("reviewer_active");
    });

    test("user_reply after loop guard resumes to coder by default", async () => {
      const machine = new FlowMachine();

      // Trigger loop guard
      for (let i = 0; i < 4; i++) {
        await machine.send({ type: "request_review" });
        await machine.send({ type: "request_changes", reason: `Issue ${i + 1}` });
      }
      expect(machine.getState()).toBe("awaiting_user_input");

      const result = await machine.send({
        type: "user_reply",
        response: "Continue with the current approach",
      });

      // Loop guard sets awaitingReplyFrom to reviewer, so should resume there
      expect(result.success).toBe(true);
      expect(result.state).toBe("reviewer_active");
    });
  });

  describe("approve with no remaining steps", () => {
    test("approve lands in awaiting_user_input when no more steps", async () => {
      const machine = new FlowMachine({ hasMoreSteps: false });
      await machine.send({ type: "request_review" });

      const result = await machine.send({ type: "approve" });

      expect(result.success).toBe(true);
      expect(result.state).toBe("awaiting_user_input");
    });

    test("message indicates completion", async () => {
      const machine = new FlowMachine({
        initialStep: "final-step",
        hasMoreSteps: false,
      });
      await machine.send({ type: "request_review" });
      await machine.send({ type: "approve" });

      const context = machine.getContext();
      expect(context.userPrompt).toContain("completed");
      expect(context.userPrompt).toContain("final-step");
    });

    test("setHasMoreSteps updates behavior", async () => {
      const machine = new FlowMachine({ hasMoreSteps: true });
      await machine.send({ type: "request_review" });

      // Change to no more steps before approve
      machine.setHasMoreSteps(false);

      const result = await machine.send({ type: "approve" });
      expect(result.state).toBe("awaiting_user_input");
    });
  });

  describe("system_error", () => {
    test("system_error from coder_active lands in error", async () => {
      const machine = new FlowMachine();

      const result = await machine.send({
        type: "system_error",
        error: "LLM unreachable",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("error");
      expect(machine.getContext().errorMessage).toBe("LLM unreachable");
    });

    test("system_error from reviewer_active lands in error", async () => {
      const machine = new FlowMachine();
      await machine.send({ type: "request_review" });

      const result = await machine.send({
        type: "system_error",
        error: "API timeout",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("error");
    });

    test("system_error from awaiting_user_input lands in error", async () => {
      const machine = new FlowMachine();
      await machine.send({
        type: "ask_user",
        message: "Question?",
        requester: "coder",
      });

      const result = await machine.send({
        type: "system_error",
        error: "Connection lost",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("error");
    });

    test("user_reply recovers from error to coder", async () => {
      const machine = new FlowMachine();
      await machine.send({ type: "system_error", error: "Error" });

      const result = await machine.send({
        type: "user_reply",
        response: "Retry",
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe("coder_active");
      expect(machine.getContext().errorMessage).toBeUndefined();
    });

    test("other events blocked in error state", async () => {
      const machine = new FlowMachine();
      await machine.send({ type: "system_error", error: "Error" });

      const result = await machine.send({ type: "request_review" });

      expect(result.success).toBe(false);
      expect(result.state).toBe("error");
      expect(result.blockedReason).toContain("error state");
    });
  });

  describe("invalid transitions", () => {
    test("reviewer events blocked in coder_active", async () => {
      const machine = new FlowMachine();

      const result = await machine.send({ type: "approve" });

      expect(result.success).toBe(false);
      expect(result.blockedReason).toContain("not valid");
    });

    test("coder events blocked in reviewer_active", async () => {
      const machine = new FlowMachine();
      await machine.send({ type: "request_review" });

      const result = await machine.send({ type: "request_review" });

      expect(result.success).toBe(false);
      expect(result.blockedReason).toContain("not valid");
    });

    test("most events blocked in awaiting_user_input", async () => {
      const machine = new FlowMachine();
      await machine.send({
        type: "ask_user",
        message: "Question?",
        requester: "coder",
      });

      const result = await machine.send({ type: "request_review" });

      expect(result.success).toBe(false);
      expect(result.blockedReason).toContain("Waiting for user_reply");
    });
  });

  describe("hooks", () => {
    test("onEnterCoder called on entry", async () => {
      const calls: string[] = [];
      const hooks: FlowHooks = {
        onEnterCoder: () => {
          calls.push("coder");
        },
      };
      const machine = new FlowMachine({}, hooks);

      // Initial state is coder_active, but hooks only fire on transitions
      await machine.send({ type: "request_review" });
      await machine.send({ type: "approve" });

      expect(calls).toContain("coder");
    });

    test("onEnterReviewer called on entry", async () => {
      const calls: string[] = [];
      const hooks: FlowHooks = {
        onEnterReviewer: () => {
          calls.push("reviewer");
        },
      };
      const machine = new FlowMachine({}, hooks);

      await machine.send({ type: "request_review" });

      expect(calls).toContain("reviewer");
    });

    test("onEnterAwaitingInput called with message", async () => {
      let capturedMessage = "";
      const hooks: FlowHooks = {
        onEnterAwaitingInput: (_ctx, msg) => {
          capturedMessage = msg;
        },
      };
      const machine = new FlowMachine({}, hooks);

      await machine.send({
        type: "ask_user",
        message: "What should I do?",
        requester: "coder",
      });

      expect(capturedMessage).toBe("What should I do?");
    });

    test("onEnterError called with error", async () => {
      let capturedError = "";
      const hooks: FlowHooks = {
        onEnterError: (_ctx, err) => {
          capturedError = err;
        },
      };
      const machine = new FlowMachine({}, hooks);

      await machine.send({ type: "system_error", error: "Network failure" });

      expect(capturedError).toBe("Network failure");
    });

    test("onTransition called for every transition", async () => {
      const transitions: Array<{ from: FlowState; to: FlowState }> = [];
      const hooks: FlowHooks = {
        onTransition: (from, to) => {
          transitions.push({ from, to });
        },
      };
      const machine = new FlowMachine({}, hooks);

      await machine.send({ type: "request_review" });
      await machine.send({ type: "approve" });

      expect(transitions).toEqual([
        { from: "coder_active", to: "reviewer_active" },
        { from: "reviewer_active", to: "coder_active" },
      ]);
    });

    test("async hooks are awaited", async () => {
      const order: string[] = [];
      const hooks: FlowHooks = {
        onEnterReviewer: async () => {
          await new Promise((r) => setTimeout(r, 10));
          order.push("hook");
        },
      };
      const machine = new FlowMachine({}, hooks);

      await machine.send({ type: "request_review" });
      order.push("after");

      expect(order).toEqual(["hook", "after"]);
    });
  });

  describe("transition history", () => {
    test("records all transitions", async () => {
      const machine = new FlowMachine();

      await machine.send({ type: "request_review" });
      await machine.send({ type: "request_changes", reason: "Fix it" });
      await machine.send({ type: "request_review" });
      await machine.send({ type: "approve" });

      const history = machine.getContext().transitionHistory;
      expect(history.length).toBe(4);
      expect(history[0].from).toBe("coder_active");
      expect(history[0].to).toBe("reviewer_active");
      expect(history[3].from).toBe("reviewer_active");
      expect(history[3].to).toBe("coder_active");
    });

    test("records timestamps", async () => {
      const before = Date.now();
      const machine = new FlowMachine();
      await machine.send({ type: "request_review" });
      const after = Date.now();

      const history = machine.getContext().transitionHistory;
      expect(history[0].timestamp).toBeGreaterThanOrEqual(before);
      expect(history[0].timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("forceState", () => {
    test("can force to any state", async () => {
      const machine = new FlowMachine();

      await machine.forceState("reviewer_active", "User override");

      expect(machine.getState()).toBe("reviewer_active");
    });

    test("clears pending state on force", async () => {
      const machine = new FlowMachine();
      await machine.send({
        type: "ask_user",
        message: "Question?",
        requester: "coder",
      });

      await machine.forceState("coder_active");

      const context = machine.getContext();
      expect(context.userPrompt).toBeUndefined();
      expect(context.awaitingReplyFrom).toBeUndefined();
    });

    test("records in transition history", async () => {
      const machine = new FlowMachine();

      await machine.forceState("error");

      const history = machine.getContext().transitionHistory;
      expect(history.length).toBe(1);
      expect(history[0].to).toBe("error");
    });

    test("runs hooks on force", async () => {
      const calls: FlowState[] = [];
      const hooks: FlowHooks = {
        onEnterReviewer: () => {
          calls.push("reviewer_active");
        },
      };
      const machine = new FlowMachine({}, hooks);

      await machine.forceState("reviewer_active");

      expect(calls).toContain("reviewer_active");
    });
  });
});
