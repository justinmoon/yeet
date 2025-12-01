import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FlowMachine,
  type FlowHooks,
  type FlowContext,
} from "../../src/plan";
import {
  ToolExecutor,
  createArrayStepResolver,
  createPlanBodyStepResolver,
  type StepResolver,
} from "../../src/plan/tool-executor";
import {
  requestReview,
  requestChanges,
  approve,
  createAskUserTool,
  createCoderTools,
  createReviewerTools,
  getToolsForRole,
  type ToolAction,
} from "../../src/plan/tools";
import {
  createToolFilter,
  filterToolsForRole,
  isWriteTool,
  isWriteBashCommand,
  createReadOnlyInterceptor,
} from "../../src/plan/tool-filter";

// Helper to execute AI SDK tools (handles the extra options argument)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeTool<T>(tool: any, args: T): Promise<any> {
  return tool.execute(args, {});
}

describe("Orchestration Tools", () => {
  describe("requestReview tool", () => {
    test("returns request_review action", async () => {
      const result = await executeTool(requestReview, {});
      expect(result).toEqual({ action: "request_review" });
    });

    test("has correct description", () => {
      expect(requestReview.description).toContain("review");
    });
  });

  describe("requestChanges tool", () => {
    test("returns request_changes action with reason", async () => {
      const result = await executeTool(requestChanges, {
        reason: "Fix the bug in line 42",
      });
      expect(result).toEqual({
        action: "request_changes",
        reason: "Fix the bug in line 42",
      });
    });

    test("has correct description", () => {
      expect(requestChanges.description).toContain("changes");
    });
  });

  describe("approve tool", () => {
    test("returns approve action", async () => {
      const result = await executeTool(approve, {});
      expect(result).toEqual({ action: "approve" });
    });

    test("has correct description", () => {
      expect(approve.description).toContain("Approve");
    });
  });

  describe("ask_user tool", () => {
    test("coder ask_user returns correct action", async () => {
      const askUser = createAskUserTool("coder");
      const result = await executeTool(askUser, { message: "Which approach?" });
      expect(result).toEqual({
        action: "ask_user",
        message: "Which approach?",
        requester: "coder",
      });
    });

    test("reviewer ask_user returns correct action", async () => {
      const askUser = createAskUserTool("reviewer");
      const result = await executeTool(askUser, { message: "Is this correct?" });
      expect(result).toEqual({
        action: "ask_user",
        message: "Is this correct?",
        requester: "reviewer",
      });
    });
  });

  describe("createCoderTools", () => {
    test("includes request_review", () => {
      const tools = createCoderTools();
      expect(tools.request_review).toBeDefined();
    });

    test("includes ask_user", () => {
      const tools = createCoderTools();
      expect(tools.ask_user).toBeDefined();
    });

    test("does not include reviewer tools", () => {
      const tools = createCoderTools();
      expect((tools as any).request_changes).toBeUndefined();
      expect((tools as any).approve).toBeUndefined();
    });
  });

  describe("createReviewerTools", () => {
    test("includes request_changes", () => {
      const tools = createReviewerTools();
      expect(tools.request_changes).toBeDefined();
    });

    test("includes approve", () => {
      const tools = createReviewerTools();
      expect(tools.approve).toBeDefined();
    });

    test("includes ask_user", () => {
      const tools = createReviewerTools();
      expect(tools.ask_user).toBeDefined();
    });

    test("does not include coder tools", () => {
      const tools = createReviewerTools();
      expect((tools as any).request_review).toBeUndefined();
    });
  });

  describe("getToolsForRole", () => {
    test("returns coder tools for coder role", () => {
      const tools = getToolsForRole("coder") as ReturnType<typeof createCoderTools>;
      expect(tools.request_review).toBeDefined();
      expect((tools as any).approve).toBeUndefined();
    });

    test("returns reviewer tools for reviewer role", () => {
      const tools = getToolsForRole("reviewer") as ReturnType<typeof createReviewerTools>;
      expect(tools.approve).toBeDefined();
      expect((tools as any).request_review).toBeUndefined();
    });
  });
});

describe("ToolExecutor", () => {
  let tmpDir: string;
  let planPath: string;
  let flowMachine: FlowMachine;
  let stepResolver: StepResolver;
  let executor: ToolExecutor;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "tool-executor-test-"));
    planPath = join(tmpDir, "plan.md");

    // Create a test plan file
    await writeFile(
      planPath,
      `---
active_step: "1"
---

## Steps

- Step 1: Setup
- Step 2: Implementation
- Step 3: Testing
`,
    );

    flowMachine = new FlowMachine({ initialStep: "1", hasMoreSteps: true });
    stepResolver = createArrayStepResolver(["1", "2", "3"]);
    executor = new ToolExecutor(flowMachine, planPath, stepResolver);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  describe("request_review action", () => {
    test("dispatches request_review event to flow machine", async () => {
      const action: ToolAction = { action: "request_review" };
      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.newState).toBe("reviewer_active");
      expect(result.triggerReviewer).toBe(true);
      expect(result.triggerCoder).toBe(false);
    });

    test("fails when not in coder_active state", async () => {
      // Move to reviewer_active first
      await executor.execute({ action: "request_review" });

      // Try to request review again (should fail)
      const result = await executor.execute({ action: "request_review" });

      expect(result.success).toBe(false);
      expect(result.blockedReason).toContain("not valid");
    });
  });

  describe("request_changes action", () => {
    test("dispatches request_changes event and returns to coder", async () => {
      // Move to reviewer state first
      await executor.execute({ action: "request_review" });

      const action: ToolAction = {
        action: "request_changes",
        reason: "Fix the bug",
      };
      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.newState).toBe("coder_active");
      expect(result.triggerCoder).toBe(true);
      expect(result.triggerReviewer).toBe(false);
    });

    test("increments change request counter", async () => {
      await executor.execute({ action: "request_review" });
      await executor.execute({ action: "request_changes", reason: "Issue 1" });

      expect(executor.getChangeRequestCount()).toBe(1);

      await executor.execute({ action: "request_review" });
      await executor.execute({ action: "request_changes", reason: "Issue 2" });

      expect(executor.getChangeRequestCount()).toBe(2);
    });

    test("triggers loop guard on 4th request", async () => {
      for (let i = 0; i < 4; i++) {
        await executor.execute({ action: "request_review" });
        const result = await executor.execute({
          action: "request_changes",
          reason: `Issue ${i + 1}`,
        });

        if (i < 3) {
          expect(result.newState).toBe("coder_active");
        } else {
          // 4th request triggers loop guard
          expect(result.newState).toBe("awaiting_user_input");
          expect(result.awaitingUser).toBe(true);
          expect(result.userPrompt).toContain("4");
        }
      }
    });
  });

  describe("approve action", () => {
    test("updates plan frontmatter with next step", async () => {
      await executor.execute({ action: "request_review" });
      const result = await executor.execute({ action: "approve" });

      expect(result.success).toBe(true);
      expect(result.newState).toBe("coder_active");

      // Check that plan frontmatter was updated
      const content = await readFile(planPath, "utf-8");
      expect(content).toContain('active_step: "2"');
    });

    test("advances flow machine to next step", async () => {
      await executor.execute({ action: "request_review" });
      await executor.execute({ action: "approve" });

      expect(executor.getActiveStep()).toBe("2");
      expect(executor.getChangeRequestCount()).toBe(0); // Reset on advance
    });

    test("lands in awaiting_user_input on final step", async () => {
      // Start at step 3 (last step)
      flowMachine = new FlowMachine({ initialStep: "3", hasMoreSteps: false });
      executor = new ToolExecutor(flowMachine, planPath, stepResolver);

      await executor.execute({ action: "request_review" });
      const result = await executor.execute({ action: "approve" });

      expect(result.success).toBe(true);
      expect(result.newState).toBe("awaiting_user_input");
      expect(result.awaitingUser).toBe(true);
      expect(result.userPrompt).toContain("completed");
    });
  });

  describe("ask_user action", () => {
    test("transitions to awaiting_user_input", async () => {
      const action: ToolAction = {
        action: "ask_user",
        message: "Which approach should I use?",
        requester: "coder",
      };
      const result = await executor.execute(action);

      expect(result.success).toBe(true);
      expect(result.newState).toBe("awaiting_user_input");
      expect(result.awaitingUser).toBe(true);
      expect(result.userPrompt).toBe("Which approach should I use?");
    });

    test("blocks until user responds", async () => {
      await executor.execute({
        action: "ask_user",
        message: "Question?",
        requester: "coder",
      });

      expect(executor.isAwaitingUser()).toBe(true);
      expect(executor.getPendingUserPrompt()).toBe("Question?");
    });

    test("resumes to coder when coder asked", async () => {
      await executor.execute({
        action: "ask_user",
        message: "Question?",
        requester: "coder",
      });

      const result = await executor.handleUserReply("Use approach A");

      expect(result.success).toBe(true);
      expect(result.newState).toBe("coder_active");
      expect(result.triggerCoder).toBe(true);
      expect(result.awaitingUser).toBe(false);
    });

    test("resumes to reviewer when reviewer asked", async () => {
      // Move to reviewer first
      await executor.execute({ action: "request_review" });

      await executor.execute({
        action: "ask_user",
        message: "Is this correct?",
        requester: "reviewer",
      });

      const result = await executor.handleUserReply("Yes");

      expect(result.success).toBe(true);
      expect(result.newState).toBe("reviewer_active");
      expect(result.triggerReviewer).toBe(true);
    });
  });

  describe("blocked action", () => {
    test("returns failure with reason", async () => {
      const action: ToolAction = {
        action: "blocked",
        reason: "Write access denied",
      };
      const result = await executor.execute(action);

      expect(result.success).toBe(false);
      expect(result.blockedReason).toBe("Write access denied");
    });
  });
});

describe("StepResolver", () => {
  describe("createArrayStepResolver", () => {
    test("returns next step in sequence", () => {
      const resolver = createArrayStepResolver(["a", "b", "c"]);

      expect(resolver.getNextStep("a")).toBe("b");
      expect(resolver.getNextStep("b")).toBe("c");
    });

    test("returns null for last step", () => {
      const resolver = createArrayStepResolver(["a", "b", "c"]);

      expect(resolver.getNextStep("c")).toBe(null);
    });

    test("returns null for unknown step", () => {
      const resolver = createArrayStepResolver(["a", "b", "c"]);

      expect(resolver.getNextStep("unknown")).toBe(null);
    });
  });

  describe("createPlanBodyStepResolver", () => {
    test("extracts steps from markdown headers", () => {
      const body = `
## Step 1: Setup
Content here

## Step 2: Implementation
More content

## Step 3: Testing
Final content
`;
      const resolver = createPlanBodyStepResolver(body);

      expect(resolver.getNextStep("1")).toBe("2");
      expect(resolver.getNextStep("2")).toBe("3");
      expect(resolver.getNextStep("3")).toBe(null);
    });

    test("extracts steps from list items", () => {
      const body = `
- Step 1: First
- Step 2: Second
- Step 3: Third
`;
      const resolver = createPlanBodyStepResolver(body);

      expect(resolver.getNextStep("1")).toBe("2");
      expect(resolver.getNextStep("2")).toBe("3");
    });

    test("extracts numbered lists", () => {
      const body = `
1. First task
2. Second task
3. Third task
`;
      const resolver = createPlanBodyStepResolver(body);

      expect(resolver.getNextStep("1")).toBe("2");
      expect(resolver.getNextStep("2")).toBe("3");
    });

    test("sorts numeric steps correctly", () => {
      const body = `
## Step 10: Tenth
## Step 2: Second
## Step 1: First
`;
      const resolver = createPlanBodyStepResolver(body);

      expect(resolver.getNextStep("1")).toBe("2");
      expect(resolver.getNextStep("2")).toBe("10");
      expect(resolver.getNextStep("10")).toBe(null);
    });
  });
});

describe("Tool Filtering", () => {
  describe("isWriteTool", () => {
    test("identifies write tools", () => {
      expect(isWriteTool("write")).toBe(true);
      expect(isWriteTool("edit")).toBe(true);
      expect(isWriteTool("delete")).toBe(true);
      expect(isWriteTool("mkdir")).toBe(true);
    });

    test("allows read tools", () => {
      expect(isWriteTool("read")).toBe(false);
      expect(isWriteTool("glob")).toBe(false);
      expect(isWriteTool("grep")).toBe(false);
      expect(isWriteTool("bash")).toBe(false); // bash itself isn't blocked, commands are
    });
  });

  describe("isWriteBashCommand", () => {
    test("blocks file modification commands", () => {
      expect(isWriteBashCommand("rm -rf /tmp/test")).toBe(true);
      expect(isWriteBashCommand("mkdir -p /new/dir")).toBe(true);
      expect(isWriteBashCommand("mv old.txt new.txt")).toBe(true);
      expect(isWriteBashCommand("touch file.txt")).toBe(true);
    });

    test("blocks redirections", () => {
      expect(isWriteBashCommand("echo hello > file.txt")).toBe(true);
      expect(isWriteBashCommand("cat >> file.txt")).toBe(true);
    });

    test("blocks git write commands", () => {
      expect(isWriteBashCommand("git commit -m 'msg'")).toBe(true);
      expect(isWriteBashCommand("git push origin main")).toBe(true);
      expect(isWriteBashCommand("git checkout -b feature")).toBe(true);
    });

    test("allows read commands", () => {
      expect(isWriteBashCommand("ls -la")).toBe(false);
      expect(isWriteBashCommand("cat file.txt")).toBe(false);
      expect(isWriteBashCommand("git status")).toBe(false);
      expect(isWriteBashCommand("git log")).toBe(false);
      expect(isWriteBashCommand("grep pattern file")).toBe(false);
    });
  });

  describe("createToolFilter", () => {
    test("coder filter allows all tools", () => {
      const filter = createToolFilter("coder");

      expect(filter("write").allowed).toBe(true);
      expect(filter("edit").allowed).toBe(true);
      expect(filter("bash", { command: "rm file" }).allowed).toBe(true);
    });

    test("reviewer filter blocks write tools", () => {
      const filter = createToolFilter("reviewer");

      expect(filter("write").allowed).toBe(false);
      expect(filter("write").reason).toContain("read-only");

      expect(filter("edit").allowed).toBe(false);
    });

    test("reviewer filter blocks write bash commands", () => {
      const filter = createToolFilter("reviewer");

      expect(filter("bash", { command: "rm -rf /tmp" }).allowed).toBe(false);
      expect(filter("bash", { command: "mkdir /test" }).allowed).toBe(false);
    });

    test("reviewer filter allows read bash commands", () => {
      const filter = createToolFilter("reviewer");

      expect(filter("bash", { command: "ls -la" }).allowed).toBe(true);
      expect(filter("bash", { command: "cat file.txt" }).allowed).toBe(true);
    });

    test("reviewer filter allows read tools", () => {
      const filter = createToolFilter("reviewer");

      expect(filter("read").allowed).toBe(true);
      expect(filter("glob").allowed).toBe(true);
      expect(filter("grep").allowed).toBe(true);
    });
  });

  describe("filterToolsForRole", () => {
    test("coder keeps all tools", () => {
      const tools = {
        read: {},
        write: {},
        edit: {},
        grep: {},
      };

      const filtered = filterToolsForRole(tools, "coder");

      expect(Object.keys(filtered)).toEqual(["read", "write", "edit", "grep"]);
    });

    test("reviewer removes write tools", () => {
      const tools = {
        read: {},
        write: {},
        edit: {},
        grep: {},
        delete: {},
      };

      const filtered = filterToolsForRole(tools, "reviewer");

      expect(Object.keys(filtered)).toEqual(["read", "grep"]);
      expect(filtered.write).toBeUndefined();
      expect(filtered.edit).toBeUndefined();
      expect(filtered.delete).toBeUndefined();
    });
  });

  describe("createReadOnlyInterceptor", () => {
    test("coder interceptor allows all", () => {
      const interceptor = createReadOnlyInterceptor("coder");

      expect(interceptor.check("write").allowed).toBe(true);
      expect(interceptor.check("edit").allowed).toBe(true);
    });

    test("reviewer interceptor blocks writes", () => {
      const interceptor = createReadOnlyInterceptor("reviewer");

      expect(interceptor.check("write").allowed).toBe(false);
      expect(interceptor.check("edit").allowed).toBe(false);
    });

    test("wrap function blocks execution", async () => {
      const interceptor = createReadOnlyInterceptor("reviewer");

      const execute = async (args: { content: string }) => args.content;
      const wrapped = interceptor.wrap("write", execute);

      const result = await wrapped({ content: "test" });

      expect(result).toEqual({
        blocked: true,
        reason: expect.stringContaining("read-only"),
      });
    });

    test("wrap function allows read operations", async () => {
      const interceptor = createReadOnlyInterceptor("reviewer");

      const execute = async (args: { path: string }) => "file contents";
      const wrapped = interceptor.wrap("read", execute);

      const result = await wrapped({ path: "/test" });

      expect(result).toBe("file contents");
    });
  });
});

describe("Integration: Full Review Cycle", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "review-cycle-test-"));
    planPath = join(tmpDir, "plan.md");

    await writeFile(
      planPath,
      `---
active_step: "1"
---

## Steps

- Step 1: Setup
- Step 2: Implementation
`,
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  test("coder → request_review → reviewer → approve cycle", async () => {
    const transitions: string[] = [];
    const hooks = {
      onTransition: (from: string, to: string) => {
        transitions.push(`${from} → ${to}`);
      },
    };

    const flowMachine = new FlowMachine({ initialStep: "1", hasMoreSteps: true }, hooks);
    const stepResolver = createArrayStepResolver(["1", "2"]);
    const executor = new ToolExecutor(flowMachine, planPath, stepResolver);

    // Coder requests review
    let result = await executor.execute({ action: "request_review" });
    expect(result.triggerReviewer).toBe(true);

    // Reviewer approves
    result = await executor.execute({ action: "approve" });
    expect(result.triggerCoder).toBe(true);

    // Verify transitions
    expect(transitions).toEqual([
      "coder_active → reviewer_active",
      "reviewer_active → coder_active",
    ]);

    // Verify step advanced
    expect(executor.getActiveStep()).toBe("2");
  });

  test("request_changes cycle with loop guard", async () => {
    const flowMachine = new FlowMachine({
      initialStep: "1",
      hasMoreSteps: true,
      maxChangeRequests: 2,
    });
    const stepResolver = createArrayStepResolver(["1", "2"]);
    const executor = new ToolExecutor(flowMachine, planPath, stepResolver);

    // First cycle
    await executor.execute({ action: "request_review" });
    await executor.execute({ action: "request_changes", reason: "Issue 1" });
    expect(executor.getState()).toBe("coder_active");

    // Second cycle
    await executor.execute({ action: "request_review" });
    await executor.execute({ action: "request_changes", reason: "Issue 2" });
    expect(executor.getState()).toBe("coder_active");

    // Third cycle triggers loop guard
    await executor.execute({ action: "request_review" });
    const result = await executor.execute({
      action: "request_changes",
      reason: "Issue 3",
    });

    expect(result.newState).toBe("awaiting_user_input");
    expect(result.awaitingUser).toBe(true);
    expect(executor.getChangeRequestCount()).toBe(3);

    // User intervenes
    const resumeResult = await executor.handleUserReply("Continue anyway");
    expect(resumeResult.newState).toBe("reviewer_active");
  });

  test("ask_user blocks and resumes correctly", async () => {
    const flowMachine = new FlowMachine({ initialStep: "1", hasMoreSteps: true });
    const stepResolver = createArrayStepResolver(["1", "2"]);
    const executor = new ToolExecutor(flowMachine, planPath, stepResolver);

    // Move to reviewer
    await executor.execute({ action: "request_review" });

    // Reviewer asks user
    const askResult = await executor.execute({
      action: "ask_user",
      message: "Is this the expected behavior?",
      requester: "reviewer",
    });

    expect(askResult.awaitingUser).toBe(true);
    expect(askResult.userPrompt).toBe("Is this the expected behavior?");
    expect(executor.isAwaitingUser()).toBe(true);

    // User responds
    const replyResult = await executor.handleUserReply("Yes, that's correct");

    expect(replyResult.newState).toBe("reviewer_active");
    expect(replyResult.triggerReviewer).toBe(true);
    expect(executor.isAwaitingUser()).toBe(false);
  });
});
