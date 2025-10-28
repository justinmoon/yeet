/**
 * E2E Test: XState Agent Loop
 *
 * Comprehensive test of the XState-based agent runtime:
 * - Tests complete state machine transitions
 * - Verifies filesystem snapshots with git tree hashes
 * - Tests control flow tools (complete, clarify, pause)
 * - Uses real model (no mocks)
 * - Validates tool history and state tracking
 *
 * Task: Write and execute fizzbuzz, call complete tool, verify output
 */

import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "path";
import { rm } from "fs/promises";
import git from "isomorphic-git";
import { createActor, waitFor } from "xstate";
import { agentMachine } from "../src/agent-machine";
import { loadConfig } from "../src/config";
import { FilesystemSnapshot } from "../src/filesystem-snapshot";

const TEST_TIMEOUT = 180_000; // 3 minutes for LLM inference

// Expected fizzbuzz output
const EXPECTED_FIZZBUZZ = `1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz`;

test(
  "XState Agent Loop E2E - FizzBuzz with Complete Tool",
  async () => {
    console.log("\n" + "=".repeat(70));
    console.log("🧪 XState Agent Loop E2E Test");
    console.log("=".repeat(70));

    // Create isolated test directory with git repo
    const testDir = `/tmp/xstate-agent-test-${Date.now()}`;
    const gitDir = path.join(testDir, ".git");
    const fizzBuzzFile = path.join(testDir, "fizzbuzz.ts");

    console.log(`\n📁 Test directory: ${testDir}`);

    try {
      // Initialize git repo for filesystem snapshots
      console.log("🔧 Initializing git repository...");
      await git.init({ fs, dir: testDir, gitdir: gitDir });

      // Create initial commit so we have a HEAD
      await Bun.write(path.join(testDir, "README.md"), "# Test Project\n");
      await git.add({
        fs,
        dir: testDir,
        gitdir: gitDir,
        filepath: "README.md",
      });
      await git.commit({
        fs,
        dir: testDir,
        gitdir: gitDir,
        message: "Initial commit",
        author: {
          name: "Test Agent",
          email: "test@example.com",
        },
      });

      console.log("✅ Git repository initialized with initial commit");

      // Capture initial snapshot
      const fsSnapshot = new FilesystemSnapshot(testDir);
      const initialSnapshot = await fsSnapshot.capture("Initial state");
      console.log(
        `📸 Initial snapshot: ${initialSnapshot.treeHash.substring(0, 8)}...`,
      );

      // Load config
      const config = await loadConfig();
      console.log(
        `\n🤖 Using ${config.activeProvider}: ${config.opencode.model}`,
      );

      // Create XState actor
      console.log("\n🎬 Creating XState actor...");
      const actor = createActor(agentMachine, {
        input: {
          currentSnapshot: initialSnapshot,
          snapshotHistory: [initialSnapshot],
          messages: [],
          currentResponse: "",
          toolHistory: [],
          currentStep: 0,
          maxSteps: 15,
          workingDirectory: testDir,
        },
      });

      // Track state transitions
      const stateTransitions: string[] = [];
      const toolCalls: Array<{ name: string; args: any }> = [];
      let agentCompleted = false;
      let completeSummary = "";

      actor.subscribe((state) => {
        const stateName = String(state.value);
        stateTransitions.push(stateName);

        console.log(`\n🔄 State: ${stateName}`);

        // Log context updates
        if (state.context.currentResponse) {
          const preview = state.context.currentResponse.substring(0, 100);
          console.log(
            `   Response: ${preview}${state.context.currentResponse.length > 100 ? "..." : ""}`,
          );
        }

        if (state.context.pendingToolCall) {
          const tool = state.context.pendingToolCall;
          console.log(`   🔧 Tool: ${tool.name}`);
          console.log(`   📦 Args:`, JSON.stringify(tool.args, null, 2));
          toolCalls.push({ name: tool.name, args: tool.args });

          // Check for complete tool
          if (tool.name === "complete") {
            agentCompleted = true;
            completeSummary = tool.args.summary || "";
          }
        }

        if (
          state.context.currentSnapshot.treeHash !== initialSnapshot.treeHash
        ) {
          const hash = state.context.currentSnapshot.treeHash.substring(0, 8);
          console.log(`   📸 Snapshot: ${hash}...`);
        }
      });

      // Start the machine
      actor.start();

      // Send the task
      const task = `Write a TypeScript file at ${fizzBuzzFile} that prints FizzBuzz for numbers 1-15. Then execute it with bun. When done, call the complete tool with a summary of what you did.`;

      console.log(`\n📤 Task: ${task}\n`);
      console.log("=".repeat(70));

      actor.send({
        type: "USER_MESSAGE",
        content: task,
      });

      // Wait for machine to reach idle or error state (with timeout)
      console.log("\n⏳ Waiting for agent to complete...\n");
      const finalState = await waitFor(
        actor,
        (state) => {
          const value = String(state.value);
          return value === "idle" || value === "error" || value === "paused";
        },
        { timeout: TEST_TIMEOUT },
      );

      console.log("\n" + "=".repeat(70));
      console.log("✅ Agent finished");
      console.log("=".repeat(70));

      // Extract final context
      const finalContext = finalState.context;

      // Print comprehensive results
      console.log("\n📊 Test Results:");
      console.log("\n1️⃣  State Transitions:");
      const uniqueStates = [...new Set(stateTransitions)];
      console.log(`   Total transitions: ${stateTransitions.length}`);
      console.log(`   Unique states: ${uniqueStates.join(" → ")}`);

      console.log("\n2️⃣  Tool Calls:");
      const toolSummary = toolCalls.reduce(
        (acc, t) => {
          acc[t.name] = (acc[t.name] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
      for (const [name, count] of Object.entries(toolSummary)) {
        console.log(`   ${name}: ${count}x`);
      }

      console.log("\n3️⃣  Conversation:");
      console.log(`   Messages: ${finalContext.messages.length}`);
      finalContext.messages.forEach((m, i) => {
        const preview = m.content.substring(0, 80);
        console.log(
          `   [${i}] ${m.role}: ${preview}${m.content.length > 80 ? "..." : ""}`,
        );
      });

      console.log("\n4️⃣  Snapshots:");
      console.log(`   Total snapshots: ${finalContext.snapshotHistory.length}`);
      finalContext.snapshotHistory.forEach((s, i) => {
        const hash = s.treeHash.substring(0, 8);
        console.log(`   [${i}] ${hash}... ${s.description || ""}`);
      });

      console.log("\n5️⃣  Tool History:");
      finalContext.toolHistory.forEach((entry, i) => {
        console.log(`   [${i}] ${entry.call.name}`);
        if (entry.result.error) {
          console.log(`       ❌ Error: ${entry.result.error}`);
        } else if (entry.call.name === "bash" && entry.result.result?.stdout) {
          const stdout = entry.result.result.stdout.trim();
          const preview = stdout.substring(0, 100);
          console.log(
            `       ✅ ${preview}${stdout.length > 100 ? "..." : ""}`,
          );
        }
      });

      // Run assertions
      console.log("\n🔍 Running Assertions:\n");

      // 1. Verify state machine went through expected states
      console.log("✓ Checking state transitions...");
      expect(uniqueStates).toContain("idle");
      expect(uniqueStates).toContain("thinking");
      expect(uniqueStates).toContain("executingTool");
      console.log("  ✅ Machine went through: idle, thinking, executingTool");

      // 2. Verify write tool was used
      console.log("\n✓ Checking write tool...");
      const writeCalls = toolCalls.filter((t) => t.name === "write");
      expect(writeCalls.length).toBeGreaterThan(0);
      const writeCall = writeCalls.find(
        (t) =>
          t.args?.path === fizzBuzzFile || t.args?.path?.includes("fizzbuzz"),
      );
      expect(writeCall).toBeDefined();
      console.log(`  ✅ Write tool called to create fizzbuzz file`);

      // 3. Verify bash tool was used to execute
      console.log("\n✓ Checking bash execution...");
      const bashCalls = toolCalls.filter((t) => t.name === "bash");
      expect(bashCalls.length).toBeGreaterThan(0);
      const execCall = bashCalls.find(
        (t) =>
          t.args?.command &&
          (t.args.command.includes("fizzbuzz") ||
            t.args.command.includes("bun")),
      );
      expect(execCall).toBeDefined();
      console.log(`  ✅ Bash tool executed fizzbuzz program`);

      // 4. Verify complete tool was called
      console.log("\n✓ Checking complete tool...");
      expect(agentCompleted).toBe(true);
      expect(completeSummary).toBeTruthy();
      console.log(`  ✅ Agent called complete with: "${completeSummary}"`);

      // 5. Verify fizzbuzz output is correct
      console.log("\n✓ Checking fizzbuzz output...");
      const bashResults = finalContext.toolHistory
        .filter((entry) => entry.call.name === "bash")
        .map((entry) => entry.result.result?.stdout?.trim())
        .filter(Boolean);

      const fizzBuzzOutput = bashResults.find(
        (output) => output?.includes("Fizz") && output.includes("Buzz"),
      );

      expect(fizzBuzzOutput).toBeDefined();
      expect(fizzBuzzOutput).toBe(EXPECTED_FIZZBUZZ.trim());
      console.log("  ✅ FizzBuzz output matches expected");

      // 6. Verify snapshots were captured
      console.log("\n✓ Checking filesystem snapshots...");
      expect(finalContext.snapshotHistory.length).toBeGreaterThan(1);
      console.log(
        `  ✅ Captured ${finalContext.snapshotHistory.length} snapshots`,
      );

      // Check that snapshots have different hashes (state actually changed)
      const uniqueHashes = new Set(
        finalContext.snapshotHistory.map((s) => s.treeHash),
      );
      expect(uniqueHashes.size).toBeGreaterThan(1);
      console.log(`  ✅ ${uniqueHashes.size} unique filesystem states`);

      // 7. Verify file exists on disk
      console.log("\n✓ Checking file system...");
      const fileExists = await Bun.file(fizzBuzzFile).exists();
      expect(fileExists).toBe(true);
      console.log(`  ✅ File exists: ${fizzBuzzFile}`);

      // 8. Verify we can restore to any snapshot
      console.log("\n✓ Testing snapshot restoration...");
      if (finalContext.snapshotHistory.length >= 2) {
        const middleSnapshot = finalContext.snapshotHistory[1];
        await fsSnapshot.restore(middleSnapshot);
        console.log(
          `  ✅ Successfully restored to snapshot ${middleSnapshot.treeHash.substring(0, 8)}...`,
        );

        // Restore back to final state
        const finalSnap = finalContext.currentSnapshot;
        await fsSnapshot.restore(finalSnap);
        console.log(`  ✅ Restored back to final state`);
      }

      // 9. Verify conversation history
      console.log("\n✓ Checking conversation...");
      expect(finalContext.messages.length).toBeGreaterThanOrEqual(2);
      expect(finalContext.messages[0].role).toBe("user");
      expect(finalContext.messages[finalContext.messages.length - 1].role).toBe(
        "assistant",
      );
      console.log("  ✅ Conversation history properly tracked");

      // 10. Verify tool history matches tool calls
      console.log("\n✓ Checking tool history integrity...");
      expect(finalContext.toolHistory.length).toBe(toolCalls.length);
      console.log(
        `  ✅ Tool history has ${finalContext.toolHistory.length} entries`,
      );

      console.log("\n" + "=".repeat(70));
      console.log("🎉 ALL TESTS PASSED!");
      console.log("=".repeat(70));

      // Cleanup actor
      actor.stop();
    } finally {
      // Cleanup test directory
      try {
        await rm(testDir, { recursive: true, force: true });
        console.log(`\n🧹 Cleaned up: ${testDir}`);
      } catch (e) {
        console.warn(`⚠️  Cleanup failed: ${e}`);
      }
    }
  },
  TEST_TIMEOUT,
);

test("XState Agent Loop - State Machine Invariants", async () => {
  console.log("\n" + "=".repeat(70));
  console.log("🧪 State Machine Invariants Test");
  console.log("=".repeat(70));

  const testDir = `/tmp/xstate-invariants-test-${Date.now()}`;
  const gitDir = path.join(testDir, ".git");

  try {
    // Setup git repo
    await git.init({ fs, dir: testDir, gitdir: gitDir });
    await Bun.write(path.join(testDir, "test.txt"), "initial");
    await git.add({ fs, dir: testDir, gitdir: gitDir, filepath: "test.txt" });
    await git.commit({
      fs,
      dir: testDir,
      gitdir: gitDir,
      message: "Initial",
      author: { name: "Test", email: "test@test.com" },
    });

    const fsSnapshot = new FilesystemSnapshot(testDir);
    const initialSnapshot = await fsSnapshot.capture("Initial");

    const config = await loadConfig();

    const actor = createActor(agentMachine, {
      input: {
        currentSnapshot: initialSnapshot,
        snapshotHistory: [initialSnapshot],
        messages: [],
        currentResponse: "",
        toolHistory: [],
        currentStep: 0,
        maxSteps: 5,
        workingDirectory: testDir,
      },
    });

    // Track invariants
    let maxConcurrentInProgress = 0;
    let currentInProgress = 0;
    const allStates: string[] = [];

    actor.subscribe((state) => {
      const stateName = String(state.value);
      allStates.push(stateName);

      // Count in-progress states
      if (stateName === "executingTool" || stateName === "thinking") {
        currentInProgress++;
        maxConcurrentInProgress = Math.max(
          maxConcurrentInProgress,
          currentInProgress,
        );
      } else {
        currentInProgress = 0;
      }
    });

    actor.start();

    // Simple task
    actor.send({
      type: "USER_MESSAGE",
      content: "Read test.txt and then call complete when done",
    });

    await waitFor(actor, (state) => String(state.value) === "idle", {
      timeout: 60_000,
    });

    console.log("\n📊 Invariants Check:");

    // Invariant 1: Machine should start and end in idle
    console.log("\n✓ Start/End states:");
    expect(allStates[0]).toBe("idle");
    expect(allStates[allStates.length - 1]).toBe("idle");
    console.log("  ✅ Starts and ends in 'idle'");

    // Invariant 2: Should never have concurrent active states
    console.log("\n✓ Concurrency:");
    expect(maxConcurrentInProgress).toBeLessThanOrEqual(1);
    console.log("  ✅ No concurrent active operations");

    // Invariant 3: Every tool call should have corresponding result
    const finalContext = actor.getSnapshot().context;
    console.log("\n✓ Tool call/result pairing:");
    expect(finalContext.toolHistory.length).toBeGreaterThan(0);
    for (const entry of finalContext.toolHistory) {
      expect(entry.call).toBeDefined();
      expect(entry.result).toBeDefined();
    }
    console.log(
      `  ✅ All ${finalContext.toolHistory.length} tool calls have results`,
    );

    // Invariant 4: Snapshot history should be monotonically increasing
    console.log("\n✓ Snapshot timestamps:");
    const timestamps = finalContext.snapshotHistory.map((s) => s.timestamp);
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
    }
    console.log("  ✅ Timestamps monotonically increasing");

    // Invariant 5: Current snapshot should be in history
    console.log("\n✓ Current snapshot consistency:");
    const currentHash = finalContext.currentSnapshot.treeHash;
    const inHistory = finalContext.snapshotHistory.some(
      (s) => s.treeHash === currentHash,
    );
    expect(inHistory).toBe(true);
    console.log("  ✅ Current snapshot exists in history");

    console.log("\n🎉 All invariants hold!");

    actor.stop();
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}, 60_000);
