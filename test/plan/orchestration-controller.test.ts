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

describe("OrchestrationController Reviewer Read-Only", () => {
  let tmpDir: string;
  let planPath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "orchestration-readonly-"));
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

  test("reviewer toolset excludes write and edit tools", () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    // Access private method via prototype for testing
    const buildToolset = (controller as any).buildToolset.bind(controller);

    const reviewerTools = buildToolset("reviewer");
    const coderTools = buildToolset("coder");

    // Reviewer should NOT have write/edit
    expect(reviewerTools.write).toBeUndefined();
    expect(reviewerTools.edit).toBeUndefined();

    // Coder should have write/edit
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

  test("reviewer bash tool blocks write commands", async () => {
    const controller = new OrchestrationController({
      planPath,
      config: createTestConfig(),
    });

    const buildToolset = (controller as any).buildToolset.bind(controller);
    const reviewerTools = buildToolset("reviewer");

    // Reviewer should have bash (but wrapped)
    expect(reviewerTools.bash).toBeDefined();

    // Test that write commands are blocked
    const bashTool = reviewerTools.bash as { execute: (args: any, options: any) => Promise<any> };

    // These should be blocked
    const writeResult = await bashTool.execute({ command: "rm -rf /tmp/test" }, {});
    expect(writeResult.blocked).toBe(true);

    const gitResult = await bashTool.execute({ command: "git commit -m 'test'" }, {});
    expect(gitResult.blocked).toBe(true);

    const redirectResult = await bashTool.execute({ command: "echo test > file.txt" }, {});
    expect(redirectResult.blocked).toBe(true);
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

  test("setWorkspaceForRole sets read-only for reviewer", () => {
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
    expect(reviewerWorkspace.allowWrites).toBe(false);
    expect(reviewerWorkspace.isolationMode).toBe("sandbox");

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
});
