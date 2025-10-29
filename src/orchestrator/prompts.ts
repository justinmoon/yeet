/**
 * Prompt templates for LLM-based workflow orchestration
 */

import type { Stage, WorkflowState } from "./state";

export function buildOrchestratorPrompt(state: WorkflowState): string {
  const stage = state.getCurrentStage();
  const workflow = state.getWorkflow();

  const isFinal = stage.isFinal || false;

  return `
You are a workflow orchestrator managing the "${workflow.name}" workflow.

Workflow Description: ${workflow.description}

=== Current State ===
${state.getContext()}

=== Current Stage: ${stage.name} ===
Goal: ${stage.goal}
Description: ${stage.description}
Available Tools: ${stage.tools.join(", ")}

=== Possible Transitions ===
${stage.transitions.map((t, i) => `${i + 1}. ${t.next}: ${t.condition}`).join("\n")}

=== Your Instructions ===
${
  isFinal
    ? `
This is a FINAL stage. Your job is to:
- Summarize the entire workflow
- Provide clear final decision/output based on all stage results
- Call the complete_workflow tool when done

<complete_workflow>
<summary>Your final summary of the entire workflow and decision</summary>
</complete_workflow>
`
    : `
1. **Execute the current stage's goal** by either:
   - Delegating to a worker agent (recommended for tasks requiring tools)
   - Performing analysis yourself (for simple decision-making)

2. **Delegate to worker** (if needed):
   Use the delegate_to_worker tool:
   <delegate_to_worker>
     <worker_type>${stage.name}</worker_type>
     <instructions>Specific instructions for worker based on stage goal</instructions>
   </delegate_to_worker>

3. **Evaluate the results** from the worker or your own analysis

4. **Decide the next transition** based on:
   - The results from this stage
   - The transition conditions listed above
   - Evidence supporting your decision

5. **Announce the transition**:
   <transition_stage>
     <from>${stage.name}</from>
     <to>next_stage_name</to>
     <reason>Clear explanation of why this transition is chosen based on evidence</reason>
     <summary>Brief summary of what was accomplished in this stage</summary>
   </transition_stage>
`
}

Remember:
- Stay focused on the current stage's goal
- Base transition decisions on evidence from the work done
- Be explicit about your reasoning
- Only move to the next stage when the current goal is achieved
- If you delegate to a worker, wait for their results before deciding the transition
`.trim();
}

export function buildWorkerPrompt(
  stageType: string,
  instructions: string,
  stageGoal: string,
  tools: string[],
  previousResults: any,
): string {
  const resultsStr =
    Object.keys(previousResults).length > 0
      ? JSON.stringify(previousResults, null, 2)
      : "None (this is the first stage)";

  return `
You are a specialist worker for the "${stageType}" stage.

Your Task:
${instructions}

Stage Goal: ${stageGoal}

Context from Previous Stages:
${resultsStr}

Available Tools:
${tools.join(", ")}

Important:
- Focus ONLY on accomplishing this stage's goal
- Use the provided tools to do your work thoroughly
- Report your findings clearly and concisely
- DO NOT try to move to the next stage - the orchestrator handles that
- When you're done, use the report_results tool to return your findings

Example:
<report_results>
  <findings>Detailed description of what you discovered/accomplished</findings>
  <recommendation>Optional: suggest what should happen next or concerns to address</recommendation>
</report_results>
`.trim();
}
