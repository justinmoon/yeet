/**
 * State management for LLM-based workflow orchestration
 */

export interface Stage {
  name: string;
  description: string;
  goal: string;
  tools: string[]; // Which tools this stage can use
  transitions: Transition[];
  isFinal?: boolean;
}

export interface Transition {
  condition: string; // Human-readable condition
  next: string; // Next stage name
}

export interface Workflow {
  name: string;
  description: string;
  initialStage: string;
  stages: Record<string, Stage>;
}

export interface OrchestratorState {
  workflow: Workflow;
  currentStage: string;
  stageHistory: string[];
  stageResults: Record<string, any>;
  isComplete: boolean;
  transitionCount: number; // Track to prevent infinite loops
}

export class WorkflowState {
  private state: OrchestratorState;

  constructor(workflow: Workflow) {
    this.state = {
      workflow,
      currentStage: workflow.initialStage,
      stageHistory: [],
      stageResults: {},
      isComplete: false,
      transitionCount: 0,
    };
  }

  getCurrentStage(): Stage {
    const stage = this.state.workflow.stages[this.state.currentStage];
    if (!stage) {
      throw new Error(
        `Invalid stage: ${this.state.currentStage} not found in workflow`,
      );
    }
    return stage;
  }

  getWorkflow(): Workflow {
    return this.state.workflow;
  }

  canTransition(from: string, to: string): boolean {
    const stage = this.state.workflow.stages[from];
    if (!stage) return false;

    // Check if transition is in allowed list
    return stage.transitions.some((t) => t.next === to);
  }

  transitionTo(nextStage: string, reason: string, results: any): void {
    const currentStage = this.state.currentStage;

    // Validate transition
    if (!this.canTransition(currentStage, nextStage)) {
      throw new Error(
        `Invalid transition: ${currentStage} → ${nextStage}. Allowed transitions: ${this.getCurrentStage()
          .transitions.map((t) => t.next)
          .join(", ")}`,
      );
    }

    // Record history
    this.state.stageHistory.push(`${currentStage} → ${nextStage}: ${reason}`);
    this.state.stageResults[currentStage] = results;
    this.state.currentStage = nextStage;
    this.state.transitionCount++;

    // Check if final
    const stage = this.getCurrentStage();
    if (stage.isFinal) {
      this.state.isComplete = true;
    }
  }

  getContext(): string {
    // Format state for prompt context
    const history =
      this.state.stageHistory.length > 0
        ? this.state.stageHistory.join("\n")
        : "None (this is the first stage)";

    const results =
      Object.keys(this.state.stageResults).length > 0
        ? JSON.stringify(this.state.stageResults, null, 2)
        : "None yet";

    return `
Current Stage: ${this.state.currentStage}
Stage History: 
${history}

Previous Stage Results:
${results}

Transition Count: ${this.state.transitionCount}
    `.trim();
  }

  getState(): OrchestratorState {
    return { ...this.state };
  }

  isWorkflowComplete(): boolean {
    return this.state.isComplete;
  }

  getTransitionCount(): number {
    return this.state.transitionCount;
  }
}
