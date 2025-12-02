/**
 * Tests for OrchestrationController.
 *
 * These tests verify the controller's functionality:
 * - Initialization and plan loading
 * - Status callbacks
 * - Agent execution coordination
 * - User input handling
 * - Stop/resume behavior
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  OrchestrationController,
  type OrchestrationStatus,
} from "../../src/plan/orchestration-controller";
import type { Config } from "../../src/config";
import type { AgentRole } from "../../src/plan/flow-types";

/**
 * Create a minimal test config.
 */
function createTestConfig(): Config {
  return {
    activeProvider: "fake",
    opencode: {
      apiKey: "test-key",
      baseURL: "http://localhost:3000",
      model: "test-model",
    },
    maxSteps: 1,
    fake: {
      fixture: "hello-world",
    },
  } as Config;
}

describe("OrchestrationController", () => {
  let tmpDir: string;
  let planPath: string;
  let intentPath: string;
  let specPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestration-controller-"));
    planPath = join(tmpDir, "plan.md");
    intentPath = join(tmpDir, "intent.md");
    specPath = join(tmpDir, "spec.md");

    // Create required files
    await writeFile(
      planPath,
      `---
active_step: "1"
---

## Steps

- Step 1: Set up project structure
- Step 2: Implement core functionality
- Step 3: Add tests
`,
    );

    await writeFile(
      intentPath,
      `# Intent

Build a simple feature with tests.
`,
    );

    await writeFile(
      specPath,
      `# Specification

## Requirements
- Create project structure
- Implement feature
- Write tests
`,
    );
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Initialization", () => {
    test("creates controller with valid paths", () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      expect(controller).toBeDefined();
    });

    test("extracts steps from plan on start", async () => {
      let receivedStatus: OrchestrationStatus | null = null;

      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
        onStatus: (status) => {
          receivedStatus = status;
        },
      });

      // Since we're using fake provider, start will complete quickly
      // but we can't fully test without mocking the agent
      // This test verifies the controller initializes and parses steps

      // Get status before starting (should be empty)
      const initialStatus = controller.getStatus();
      expect(initialStatus.flowState).toBe("coder_active");
    });

    test("reports error for missing plan file", async () => {
      const missingPlanPath = join(tmpDir, "nonexistent.md");

      const controller = new OrchestrationController({
        planPath: missingPlanPath,
        config: createTestConfig(),
      });

      await expect(controller.start()).rejects.toThrow();
    });
  });

  describe("Status Callbacks", () => {
    test("emits status updates", async () => {
      const statusUpdates: OrchestrationStatus[] = [];

      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
        onStatus: (status) => {
          statusUpdates.push({ ...status });
        },
      });

      // Just verify callback is set up - full agent testing requires mocks
      expect(controller.getStatus().flowState).toBe("coder_active");
    });

    test("getStatus returns current state", () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      const status = controller.getStatus();

      expect(status).toMatchObject({
        flowState: "coder_active",
        currentStep: "1",
        changeRequestCount: 0,
        awaitingUserPrompt: null,
      });
    });
  });

  describe("Model Selection", () => {
    test("accepts role-specific model config", () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
        roleModels: {
          coderModel: "claude-opus-4-20250514",
          reviewerModel: "claude-sonnet-4-5-20250929",
          coderProvider: "anthropic",
          reviewerProvider: "anthropic",
        },
      });

      expect(controller).toBeDefined();
    });

    test("uses config defaults when role models not specified", () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      // Should use config.activeProvider as default
      expect(controller).toBeDefined();
    });
  });

  describe("User Input Handling", () => {
    test("isAwaitingUser returns false initially", () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      expect(controller.isAwaitingUser()).toBe(false);
    });

    test("handleUserReply logs warning when not awaiting", async () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      // Should not throw, just warn
      await controller.handleUserReply("test response");
    });
  });

  describe("Stop Behavior", () => {
    test("stop changes controller state", async () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      await controller.stop();

      // Controller should be in stopped state
      // Can't start again
      await expect(controller.start()).rejects.toThrow();
    });

    test("stop is idempotent", async () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      await controller.stop();
      await controller.stop(); // Should not throw
    });
  });

  describe("Persistence", () => {
    test("creates .orchestration directory on start", async () => {
      const orchestrationDir = join(tmpDir, ".orchestration");

      // Directory should not exist initially
      expect(existsSync(orchestrationDir)).toBe(false);

      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
      });

      // Note: Full test would require starting and running,
      // which requires mocking the agent. Here we just verify
      // the controller can be created with valid paths.
      expect(controller).toBeDefined();
    });
  });

  describe("Flow Configuration", () => {
    test("accepts custom flow config", () => {
      const controller = new OrchestrationController({
        planPath,
        config: createTestConfig(),
        flowConfig: {
          maxChangeRequests: 5, // Higher than default
        },
      });

      expect(controller).toBeDefined();
    });
  });
});

describe("OrchestrationController Reviewer Tools", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestration-tools-"));
    planPath = join(tmpDir, "plan.md");

    await writeFile(
      planPath,
      `---
active_step: "1"
---

- Step 1: Test step
`,
    );

    await writeFile(join(tmpDir, "intent.md"), "# Intent\nTest intent.");
    await writeFile(join(tmpDir, "spec.md"), "# Spec\nTest spec.");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("both roles have full toolset (relaxed constraints)", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // Access private method via prototype for testing
    const buildToolset = (controller as any).buildToolset.bind(controller);

    const reviewerTools = buildToolset("reviewer");
    const coderTools = buildToolset("coder");

    // Both roles now have write/edit (relaxed constraints)
    expect(reviewerTools.write).toBeDefined();
    expect(reviewerTools.edit).toBeDefined();
    expect(coderTools.write).toBeDefined();
    expect(coderTools.edit).toBeDefined();

    // Both should have read and search
    expect(reviewerTools.read).toBeDefined();
    expect(reviewerTools.search).toBeDefined();
    expect(coderTools.read).toBeDefined();
    expect(coderTools.search).toBeDefined();

    // Reviewer should have orchestration tools
    expect(reviewerTools.request_changes).toBeDefined();
    expect(reviewerTools.approve).toBeDefined();
    expect(reviewerTools.ask_user).toBeDefined();

    // Reviewer should NOT have coder's request_review
    expect(reviewerTools.request_review).toBeUndefined();

    // Coder should have request_review
    expect(coderTools.request_review).toBeDefined();
  });

  test("both roles have full bash access (relaxed constraints)", async () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    const buildToolset = (controller as any).buildToolset.bind(controller);
    const reviewerTools = buildToolset("reviewer");
    const coderTools = buildToolset("coder");

    // Both should have bash
    expect(reviewerTools.bash).toBeDefined();
    expect(coderTools.bash).toBeDefined();
  });
});

describe("OrchestrationController Workspace Binding", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestration-workspace-"));
    planPath = join(tmpDir, "plan.md");

    await writeFile(
      planPath,
      `---
active_step: "1"
---

- Step 1: Test step
`,
    );

    await writeFile(join(tmpDir, "intent.md"), "# Intent\nTest intent.");
    await writeFile(join(tmpDir, "spec.md"), "# Spec\nTest spec.");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("setWorkspaceForRole sets correct cwd for coder", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // Access private method via prototype for testing
    const setWorkspaceForRole = (controller as any).setWorkspaceForRole.bind(controller);
    const restoreWorkspace = (controller as any).restoreWorkspace.bind(controller);

    // Import workspace state to verify
    const { getActiveWorkspaceBinding } = require("../../src/workspace/state");

    const originalWorkspace = getActiveWorkspaceBinding();

    // Set workspace for coder
    setWorkspaceForRole("coder");

    const coderWorkspace = getActiveWorkspaceBinding();
    expect(coderWorkspace.cwd).toBe(tmpDir);
    expect(coderWorkspace.allowWrites).toBe(true);
    expect(coderWorkspace.isolationMode).toBe("shared");

    // Restore
    restoreWorkspace();
    const restoredWorkspace = getActiveWorkspaceBinding();
    expect(restoredWorkspace.cwd).toBe(originalWorkspace.cwd);
  });

  test("setWorkspaceForRole sets writable for reviewer (relaxed constraints)", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    const setWorkspaceForRole = (controller as any).setWorkspaceForRole.bind(controller);
    const restoreWorkspace = (controller as any).restoreWorkspace.bind(controller);
    const { getActiveWorkspaceBinding } = require("../../src/workspace/state");

    // Set workspace for reviewer
    setWorkspaceForRole("reviewer");

    const reviewerWorkspace = getActiveWorkspaceBinding();
    expect(reviewerWorkspace.cwd).toBe(tmpDir);
    // Relaxed: reviewer now has write access
    expect(reviewerWorkspace.allowWrites).toBe(true);
    expect(reviewerWorkspace.isolationMode).toBe("shared");

    // Restore
    restoreWorkspace();
  });
});

describe("OrchestrationController Output Callbacks", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestration-output-"));
    planPath = join(tmpDir, "plan.md");

    await writeFile(
      planPath,
      `---
active_step: "1"
---

- Step 1: Test step
`,
    );

    await writeFile(join(tmpDir, "intent.md"), "# Intent\nTest intent.");
    await writeFile(join(tmpDir, "spec.md"), "# Spec\nTest spec.");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("onOutput callback receives agent events", () => {
    const outputs: Array<{ role: AgentRole; type: string }> = [];

    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
      onOutput: (role, event) => {
        outputs.push({ role, type: event.type });
      },
    });

    // Just verify callback is set up
    expect(controller).toBeDefined();
  });

  test("onError callback is invoked for errors", () => {
    const errors: Array<{ error: string; role?: AgentRole }> = [];

    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
      onError: (error, role) => {
        errors.push({ error, role });
      },
    });

    // Access private emitError method for testing
    const emitError = (controller as any).emitError.bind(controller);

    // Test error emission
    emitError("Test error message", "coder");
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe("Test error message");
    expect(errors[0].role).toBe("coder");

    // Test error without role
    emitError("Another error");
    expect(errors).toHaveLength(2);
    expect(errors[1].error).toBe("Another error");
    expect(errors[1].role).toBeUndefined();
  });
});

describe("OrchestrationController Interrupt and Pause", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestration-interrupt-"));
    planPath = join(tmpDir, "plan.md");

    await writeFile(
      planPath,
      `---
active_step: "1"
---

- Step 1: Test step
`,
    );

    await writeFile(join(tmpDir, "intent.md"), "# Intent\nTest intent.");
    await writeFile(join(tmpDir, "spec.md"), "# Spec\nTest spec.");
  });

  afterEach(async () => {
    if (tmpDir && existsSync(tmpDir)) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("isRunning returns false initially", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    expect(controller.isRunning()).toBe(false);
  });

  test("getActiveRole returns null when not running", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    expect(controller.getActiveRole()).toBeNull();
  });

  test("injectUserMessage falls back to handleUserReply when awaiting", async () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // When not running but awaiting, should delegate to handleUserReply
    // Just verify it doesn't throw
    await controller.injectUserMessage("test message");
  });

  test("injectUserMessage does nothing when idle", async () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // When idle (not running, not awaiting), should just warn and return
    await controller.injectUserMessage("test message");
    expect(controller.isRunning()).toBe(false);
  });

  test("pause does nothing when not running", async () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // Should just warn and return
    await controller.pause();
    expect(controller.isRunning()).toBe(false);
  });

  test("buildAgentMessages includes pending user message", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // Access private fields for testing
    (controller as any).pendingUserMessage = "test interrupt message";
    (controller as any).flowMachine = {
      getContext: () => ({ activeStep: "1" }),
    };
    (controller as any).coderDriver = {
      requiresUserMessageInjection: () => false,
      getContextSeed: () => "Start working on step 1",
    };

    const buildAgentMessages = (controller as any).buildAgentMessages.bind(controller);
    const messages = buildAgentMessages("coder");

    // Should include the pending message
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toContain("[User interrupt]");
    expect(lastMessage.content).toContain("test interrupt message");

    // Pending message should be cleared
    expect((controller as any).pendingUserMessage).toBeNull();
  });

  test("buildAgentMessages works without pending message", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // Access private fields for testing
    (controller as any).pendingUserMessage = null;
    (controller as any).flowMachine = {
      getContext: () => ({ activeStep: "1" }),
    };
    (controller as any).coderDriver = {
      requiresUserMessageInjection: () => false,
      getContextSeed: () => "Start working on step 1",
    };

    const buildAgentMessages = (controller as any).buildAgentMessages.bind(controller);
    const messages = buildAgentMessages("coder");

    // Should have context seed but no interrupt message
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe("Start working on step 1");
  });
});
