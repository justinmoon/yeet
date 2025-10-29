/**
 * Concurrent workflow execution
 * 
 * Extends the orchestrator to support parallel stages
 */

import type { Workflow, Stage } from "./state";

/**
 * Extended stage definition with parallel execution support
 */
export interface ParallelStage extends Stage {
  // Stages that can run in parallel with this one
  parallelWith?: string[];
  
  // Wait for these stages to complete before proceeding
  waitFor?: string[];
}

/**
 * Extended workflow with parallel stage support
 */
export interface ParallelWorkflow extends Workflow {
  stages: Record<string, ParallelStage>;
}

/**
 * State for concurrent execution
 */
export interface ConcurrentState {
  workflow: ParallelWorkflow;
  
  // Multiple stages can be active at once
  activeStages: Set<string>;
  
  // Track which stages are complete
  completedStages: Set<string>;
  
  // Results from each stage
  stageResults: Record<string, any>;
  
  // Track stage start/end times
  stageTiming: Record<string, { start: number; end?: number }>;
  
  // Full history of all transitions
  history: Array<{
    type: "start" | "complete" | "transition";
    stage: string;
    timestamp: number;
    reason?: string;
  }>;
}

export class ConcurrentOrchestrator {
  private state: ConcurrentState;

  constructor(workflow: ParallelWorkflow) {
    this.state = {
      workflow,
      activeStages: new Set([workflow.initialStage]),
      completedStages: new Set(),
      stageResults: {},
      stageTiming: {},
      history: [
        {
          type: "start",
          stage: workflow.initialStage,
          timestamp: Date.now(),
        },
      ],
    };
  }

  /**
   * Check if a stage's dependencies are satisfied
   */
  canStartStage(stageName: string): boolean {
    const stage = this.state.workflow.stages[stageName];
    if (!stage) return false;

    // If stage has waitFor, check all dependencies are complete
    if (stage.waitFor) {
      return stage.waitFor.every((dep) =>
        this.state.completedStages.has(dep),
      );
    }

    return true;
  }

  /**
   * Get all stages that can currently be executed
   */
  getRunnableStages(): string[] {
    const runnable: string[] = [];

    // Check all non-completed stages
    Object.keys(this.state.workflow.stages).forEach((stageName) => {
      if (
        !this.state.completedStages.has(stageName) &&
        !this.state.activeStages.has(stageName) &&
        this.canStartStage(stageName)
      ) {
        runnable.push(stageName);
      }
    });

    return runnable;
  }

  /**
   * Mark a stage as started
   */
  startStage(stageName: string): void {
    this.state.activeStages.add(stageName);
    this.state.stageTiming[stageName] = { start: Date.now() };
    this.state.history.push({
      type: "start",
      stage: stageName,
      timestamp: Date.now(),
    });
  }

  /**
   * Mark a stage as complete and find next stages to run
   */
  completeStage(stageName: string, results: any): string[] {
    this.state.activeStages.delete(stageName);
    this.state.completedStages.add(stageName);
    this.state.stageResults[stageName] = results;

    const timing = this.state.stageTiming[stageName];
    if (timing) {
      timing.end = Date.now();
    }

    this.state.history.push({
      type: "complete",
      stage: stageName,
      timestamp: Date.now(),
    });

    // Find which stages can now run
    const stage = this.state.workflow.stages[stageName];
    const nextStages: string[] = [];

    // Check transitions from this stage
    stage.transitions.forEach((t) => {
      if (this.canStartStage(t.next)) {
        nextStages.push(t.next);
      }
    });

    // Check if any stages were waiting for this one
    Object.entries(this.state.workflow.stages).forEach(([name, s]) => {
      if (s.waitFor?.includes(stageName) && this.canStartStage(name)) {
        nextStages.push(name);
      }
    });

    return nextStages;
  }

  /**
   * Check if workflow is complete
   */
  isComplete(): boolean {
    return (
      this.state.activeStages.size === 0 &&
      Object.values(this.state.workflow.stages).some(
        (s) => s.isFinal && this.state.completedStages.has(s.name),
      )
    );
  }

  /**
   * Get current state snapshot
   */
  getState(): ConcurrentState {
    return { ...this.state };
  }

  /**
   * Visualize current execution state
   */
  visualizeState(): string {
    const lines: string[] = [];

    lines.push("=".repeat(70));
    lines.push("CONCURRENT EXECUTION STATE");
    lines.push("=".repeat(70));
    lines.push("");

    // Active stages
    lines.push(`Active stages (${this.state.activeStages.size}):`);
    this.state.activeStages.forEach((stage) => {
      const timing = this.state.stageTiming[stage];
      const elapsed = timing ? Date.now() - timing.start : 0;
      lines.push(`  🔄 ${stage} (${(elapsed / 1000).toFixed(1)}s)`);
    });
    lines.push("");

    // Completed stages
    lines.push(`Completed stages (${this.state.completedStages.size}):`);
    this.state.completedStages.forEach((stage) => {
      const timing = this.state.stageTiming[stage];
      const duration = timing?.end && timing.start ? timing.end - timing.start : 0;
      lines.push(`  ✓ ${stage} (${(duration / 1000).toFixed(1)}s)`);
    });
    lines.push("");

    // Pending stages
    const pending = Object.keys(this.state.workflow.stages).filter(
      (s) =>
        !this.state.activeStages.has(s) &&
        !this.state.completedStages.has(s),
    );
    if (pending.length > 0) {
      lines.push(`Pending stages (${pending.length}):`);
      pending.forEach((stage) => {
        const s = this.state.workflow.stages[stage];
        const waiting = s.waitFor
          ? ` (waiting for: ${s.waitFor.join(", ")})`
          : "";
        lines.push(`  ○ ${stage}${waiting}`);
      });
    }

    lines.push("");
    lines.push("=".repeat(70));

    return lines.join("\n");
  }
}

/**
 * Example: Parallel code review workflow
 */
export const PARALLEL_CODE_REVIEW: ParallelWorkflow = {
  name: "parallel_code_review",
  description: "Code review with parallel security and style checks",
  initialStage: "analyze",

  stages: {
    analyze: {
      name: "analyze",
      description: "Analyze code changes",
      goal: "Understand what changed and identify areas for review",
      tools: ["read", "search"],
      transitions: [
        { condition: "Analysis complete", next: "security" },
        { condition: "Analysis complete", next: "style" }, // Both!
      ],
    },

    // These two run IN PARALLEL
    security: {
      name: "security",
      description: "Security analysis",
      goal: "Check for vulnerabilities",
      tools: ["read", "search", "bash"],
      parallelWith: ["style"], // Can run alongside style check
      transitions: [
        { condition: "Security check complete", next: "aggregate" },
      ],
    },

    style: {
      name: "style",
      description: "Style analysis",
      goal: "Check formatting and conventions",
      tools: ["read", "bash"],
      parallelWith: ["security"], // Can run alongside security check
      transitions: [{ condition: "Style check complete", next: "aggregate" }],
    },

    // This waits for BOTH security and style
    aggregate: {
      name: "aggregate",
      description: "Aggregate results",
      goal: "Combine findings from parallel checks",
      tools: ["read"],
      waitFor: ["security", "style"], // WAIT for both
      transitions: [
        { condition: "Critical issues found", next: "reject" },
        { condition: "Minor issues found", next: "suggest" },
        { condition: "No issues found", next: "approve" },
      ],
    },

    suggest: {
      name: "suggest",
      description: "Suggest improvements",
      goal: "Provide actionable suggestions",
      tools: ["read"],
      transitions: [{ condition: "Suggestions made", next: "approve" }],
    },

    approve: {
      name: "approve",
      description: "Approve changes",
      goal: "Final approval",
      tools: [],
      transitions: [],
      isFinal: true,
    },

    reject: {
      name: "reject",
      description: "Reject changes",
      goal: "Explain rejection",
      tools: [],
      transitions: [],
      isFinal: true,
    },
  },
};

/**
 * More complex example: Multi-path validation
 */
export const PARALLEL_VALIDATION: ParallelWorkflow = {
  name: "parallel_validation",
  description: "Run multiple validation checks in parallel",
  initialStage: "prepare",

  stages: {
    prepare: {
      name: "prepare",
      description: "Prepare for validation",
      goal: "Set up test environment",
      tools: ["bash"],
      transitions: [
        { condition: "Ready", next: "unit_tests" },
        { condition: "Ready", next: "integration_tests" },
        { condition: "Ready", next: "lint" },
        { condition: "Ready", next: "typecheck" },
      ],
    },

    // All four of these run IN PARALLEL
    unit_tests: {
      name: "unit_tests",
      description: "Run unit tests",
      goal: "Execute unit test suite",
      tools: ["bash"],
      parallelWith: ["integration_tests", "lint", "typecheck"],
      transitions: [{ condition: "Tests complete", next: "report" }],
    },

    integration_tests: {
      name: "integration_tests",
      description: "Run integration tests",
      goal: "Execute integration test suite",
      tools: ["bash"],
      parallelWith: ["unit_tests", "lint", "typecheck"],
      transitions: [{ condition: "Tests complete", next: "report" }],
    },

    lint: {
      name: "lint",
      description: "Run linter",
      goal: "Check code style",
      tools: ["bash"],
      parallelWith: ["unit_tests", "integration_tests", "typecheck"],
      transitions: [{ condition: "Lint complete", next: "report" }],
    },

    typecheck: {
      name: "typecheck",
      description: "Run type checker",
      goal: "Verify type safety",
      tools: ["bash"],
      parallelWith: ["unit_tests", "integration_tests", "lint"],
      transitions: [{ condition: "Typecheck complete", next: "report" }],
    },

    // Wait for ALL four to finish
    report: {
      name: "report",
      description: "Generate report",
      goal: "Summarize all validation results",
      tools: ["write"],
      waitFor: ["unit_tests", "integration_tests", "lint", "typecheck"],
      transitions: [
        { condition: "Any failures", next: "fail" },
        { condition: "All passed", next: "pass" },
      ],
    },

    pass: {
      name: "pass",
      description: "All checks passed",
      goal: "Mark as passed",
      tools: [],
      transitions: [],
      isFinal: true,
    },

    fail: {
      name: "fail",
      description: "Some checks failed",
      goal: "Mark as failed",
      tools: [],
      transitions: [],
      isFinal: true,
    },
  },
};
