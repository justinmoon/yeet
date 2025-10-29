#!/usr/bin/env bun
/**
 * Demo of workflow visualization
 */

import {
  executionToMermaid,
  workflowToASCII,
  workflowToDOT,
  workflowToMermaid,
} from "./visualize";
import { BUG_INVESTIGATION_WORKFLOW, CODE_REVIEW_WORKFLOW } from "./workflows";

console.log("=".repeat(70));
console.log("WORKFLOW VISUALIZATION DEMO");
console.log("=".repeat(70));
console.log("");

// 1. ASCII visualization
console.log("1. ASCII Visualization:");
console.log("");
console.log(workflowToASCII(CODE_REVIEW_WORKFLOW));
console.log("");

// 2. Mermaid diagram
console.log("2. Mermaid Diagram (paste into https://mermaid.live):");
console.log("");
console.log("```mermaid");
console.log(workflowToMermaid(CODE_REVIEW_WORKFLOW));
console.log("```");
console.log("");

// 3. Example execution path
console.log("3. Example Execution Path:");
console.log("");
const exampleHistory = [
  "analyze → security: SQL injection vulnerability detected",
  "security → reject: Critical security issue found",
];
console.log("```mermaid");
console.log(executionToMermaid(CODE_REVIEW_WORKFLOW, exampleHistory));
console.log("```");
console.log("");

// 4. DOT format
console.log("4. DOT Format (for Graphviz):");
console.log("");
console.log(workflowToDOT(CODE_REVIEW_WORKFLOW));
console.log("");

// 5. Bug investigation workflow
console.log("=".repeat(70));
console.log("BUG INVESTIGATION WORKFLOW");
console.log("=".repeat(70));
console.log("");
console.log(workflowToASCII(BUG_INVESTIGATION_WORKFLOW));
