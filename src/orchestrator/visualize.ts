/**
 * Workflow visualization - generate Mermaid diagrams
 */

import type { Stage, Workflow } from "./state";

/**
 * Generate a Mermaid state diagram from a workflow definition
 */
export function workflowToMermaid(workflow: Workflow): string {
  const lines: string[] = [];

  lines.push("stateDiagram-v2");
  lines.push(`    [*] --> ${workflow.initialStage}`);
  lines.push("");

  // Add all stages
  Object.entries(workflow.stages).forEach(([name, stage]) => {
    // Add stage description as note
    lines.push(`    ${name}: ${stage.name}`);
    lines.push(`    note right of ${name}`);
    lines.push(`        ${stage.goal}`);
    lines.push(`    end note`);
    lines.push("");

    // Add transitions
    stage.transitions.forEach((transition) => {
      lines.push(`    ${name} --> ${transition.next}: ${transition.condition}`);
    });

    // If final, show end
    if (stage.isFinal) {
      lines.push(`    ${name} --> [*]`);
    }

    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Generate a Mermaid flowchart showing the actual execution path
 */
export function executionToMermaid(
  workflow: Workflow,
  history: string[],
): string {
  const lines: string[] = [];

  lines.push("flowchart TD");
  lines.push(`    Start([Start: ${workflow.name}])`);
  lines.push("");

  // Parse history into steps
  let prevNode = "Start";
  history.forEach((entry, idx) => {
    const match = entry.match(/(\w+) → (\w+): (.+)/);
    if (!match) return;

    const [, from, to, reason] = match;
    const nodeId = `Step${idx}`;

    lines.push(`    ${nodeId}["${to}"]`);
    lines.push(
      `    ${prevNode} -->|"${reason.substring(0, 40)}..."| ${nodeId}`,
    );
    lines.push("");

    prevNode = nodeId;
  });

  lines.push(`    ${prevNode} --> End([Complete])`);

  return lines.join("\n");
}

/**
 * Generate ASCII art visualization of workflow
 */
export function workflowToASCII(workflow: Workflow): string {
  const lines: string[] = [];

  lines.push(`Workflow: ${workflow.name}`);
  lines.push("=".repeat(60));
  lines.push("");

  // Build graph representation
  const stages = Object.values(workflow.stages);
  const stageNames = Object.keys(workflow.stages);

  // Start
  lines.push(`[START] → ${workflow.initialStage}`);
  lines.push("");

  // Stages
  stageNames.forEach((name) => {
    const stage = workflow.stages[name];

    lines.push(`┌${"─".repeat(58)}┐`);
    lines.push(`│ ${name.toUpperCase().padEnd(56)} │`);
    lines.push(`├${"─".repeat(58)}┤`);
    lines.push(`│ Goal: ${stage.goal.substring(0, 50).padEnd(51)}│`);
    lines.push(
      `│ Tools: ${stage.tools.join(", ").substring(0, 48).padEnd(49)}│`,
    );
    lines.push(`└${"─".repeat(58)}┘`);

    if (stage.transitions.length > 0) {
      lines.push("    │");
      stage.transitions.forEach((t, idx) => {
        const isLast = idx === stage.transitions.length - 1;
        const prefix = isLast ? "    └──" : "    ├──";
        lines.push(`${prefix}[ ${t.condition.substring(0, 40)} ]`);
        lines.push(`    ${isLast ? "   " : "│"}   ↓`);
        lines.push(`    ${isLast ? "   " : "│"}  ${t.next}`);
        if (!isLast) lines.push("    │");
      });
    } else {
      lines.push("    ↓");
      lines.push("  [END]");
    }

    lines.push("");
  });

  return lines.join("\n");
}

/**
 * Live visualization during execution - shows current state
 */
export function visualizeCurrentState(
  workflow: Workflow,
  currentStage: string,
  history: string[],
): string {
  const lines: string[] = [];

  lines.push("═".repeat(70));
  lines.push(`  WORKFLOW: ${workflow.name.toUpperCase()}`.padEnd(70, " "));
  lines.push("═".repeat(70));
  lines.push("");

  // Progress indicator
  const allStages = Object.keys(workflow.stages);
  const completedStages = new Set(history.map((h) => h.split(" → ")[0]));

  lines.push("Progress:");
  allStages.forEach((stage) => {
    const isCurrent = stage === currentStage;
    const isCompleted = completedStages.has(stage);

    let symbol = "○"; // pending
    if (isCompleted) symbol = "●"; // completed
    if (isCurrent) symbol = "◉"; // current

    lines.push(`  ${symbol} ${stage}`);
  });

  lines.push("");
  lines.push("Recent History:");
  history.slice(-3).forEach((h) => {
    lines.push(`  → ${h}`);
  });

  lines.push("");
  lines.push("═".repeat(70));

  return lines.join("\n");
}

/**
 * Export workflow as DOT format (for Graphviz)
 */
export function workflowToDOT(workflow: Workflow): string {
  const lines: string[] = [];

  lines.push("digraph workflow {");
  lines.push("  rankdir=TB;");
  lines.push("  node [shape=box, style=rounded];");
  lines.push("");

  // Start node
  lines.push('  start [label="Start", shape=circle];');
  lines.push(`  start -> ${workflow.initialStage};`);
  lines.push("");

  // Stages
  Object.entries(workflow.stages).forEach(([name, stage]) => {
    const shape = stage.isFinal ? "doublecircle" : "box";
    lines.push(
      `  ${name} [label="${name}\\n${stage.goal.substring(0, 30)}...", shape=${shape}];`,
    );

    stage.transitions.forEach((t) => {
      lines.push(
        `  ${name} -> ${t.next} [label="${t.condition.substring(0, 20)}..."];`,
      );
    });

    lines.push("");
  });

  lines.push("}");

  return lines.join("\n");
}
