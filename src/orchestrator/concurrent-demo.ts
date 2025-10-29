#!/usr/bin/env bun
/**
 * Demo of concurrent workflow execution
 */

import { PARALLEL_CODE_REVIEW, PARALLEL_VALIDATION } from "./concurrent";
import { workflowToASCII } from "./visualize";

console.log("=".repeat(70));
console.log("CONCURRENT WORKFLOW EXAMPLES");
console.log("=".repeat(70));
console.log("");

// Show parallel code review structure
console.log("1. PARALLEL CODE REVIEW");
console.log("   (security and style run at the same time)");
console.log("");
console.log(workflowToASCII(PARALLEL_CODE_REVIEW));
console.log("");

console.log("=".repeat(70));
console.log("");

// Show parallel validation structure
console.log("2. PARALLEL VALIDATION");
console.log(
  "   (4 checks run simultaneously: tests, integration, lint, typecheck)",
);
console.log("");
console.log(workflowToASCII(PARALLEL_VALIDATION));
console.log("");

console.log("=".repeat(70));
console.log("");

console.log("Key Features:");
console.log("  • parallelWith: Stages that can run simultaneously");
console.log("  • waitFor: Stages that must complete before starting");
console.log("  • Automatic dependency resolution");
console.log("  • Race-based completion (wait for any stage to finish)");
console.log("  • Speedup metrics (compare to sequential execution)");
console.log("");

console.log("Example timing:");
console.log("  Sequential:");
console.log("    security (30s) → style (20s) → aggregate (5s) = 55s");
console.log("");
console.log("  Parallel:");
console.log("    security (30s) }");
console.log("    style (20s)    } → aggregate (5s) = 35s");
console.log("    └─ 1.57x speedup!");
console.log("");

console.log("To run:");
console.log(
  '  bun run src/orchestrator/concurrent-cli.ts parallel-code-review "task"',
);
