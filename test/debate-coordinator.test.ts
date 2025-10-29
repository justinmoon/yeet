/**
 * Test the debate coordinator
 */

import { describe, expect, test } from "bun:test";
import { coordinateDebate } from "../src/debate-coordinator";

describe("Debate Coordinator", () => {
  test("should coordinate debate between two reviewers", async () => {
    const implementations = new Map([
      [
        "coder1",
        {
          messages: [
            {
              role: "assistant",
              content:
                "Created hello.txt with Hello World using the write tool",
            },
          ],
          workingDir: "/tmp/test-coder1",
          success: true,
        },
      ],
    ]);

    const reviews = new Map([
      ["reviewer1", "Initial review: Looks good, very simple implementation"],
      ["reviewer2", "Initial review: Agree, but could add more error handling"],
    ]);

    console.log("\n🧪 Testing debate coordinator...");

    const result = await coordinateDebate({
      implementations,
      reviews,
      reviewerModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
      maxRounds: 3,
      checkApproval: false,
    });

    console.log(`\n📊 Debate Results:`);
    console.log(`  Consensus: ${result.consensus.substring(0, 150)}...`);
    console.log(`  Approved: ${result.approved}`);
    console.log(`  Transcript length: ${result.transcript.length}`);

    // Verify results
    expect(result.consensus).toBeDefined();
    expect(result.consensus.length).toBeGreaterThan(10);
    expect(result.transcript.length).toBeGreaterThan(2); // At least initial reviews + 1 round
  }, 120000); // 2 minute timeout for debate

  test("should handle approval check", async () => {
    const implementations = new Map([
      [
        "revised",
        {
          messages: [
            {
              role: "assistant",
              content:
                "Created hello.txt with proper error handling and validation",
            },
          ],
          workingDir: "/tmp/test-revised",
          success: true,
        },
      ],
    ]);

    const reviews = new Map();

    console.log("\n🧪 Testing approval check...");

    const result = await coordinateDebate({
      implementations,
      reviews,
      reviewerModels: ["claude-sonnet-4-5", "claude-haiku-4-5"],
      maxRounds: 2,
      checkApproval: true,
    });

    console.log(`\n📊 Approval Results:`);
    console.log(`  Consensus: ${result.consensus.substring(0, 150)}...`);
    console.log(`  Approved: ${result.approved}`);

    // Verify results
    expect(result.consensus).toBeDefined();
    expect(result.transcript.length).toBeGreaterThan(0);
    expect(result.consensus.length).toBeGreaterThan(5);
  }, 120000); // 2 minute timeout
});
