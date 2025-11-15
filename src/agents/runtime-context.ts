import type { AgentCapability } from "../config";

export interface ActiveAgentContext {
  sessionId: string | null;
  agentId?: string;
  capability?: AgentCapability;
}

const contextStack: ActiveAgentContext[] = [];

export function pushActiveAgentContext(
  context: ActiveAgentContext,
): void {
  contextStack.push({
    sessionId: context.sessionId ?? null,
    agentId: context.agentId,
    capability: context.capability,
  });
}

export function popActiveAgentContext(
  context?: ActiveAgentContext,
): void {
  if (contextStack.length === 0) {
    return;
  }

  const current = contextStack[contextStack.length - 1];
  if (
    context &&
    current.sessionId === (context.sessionId ?? null) &&
    current.agentId === context.agentId
  ) {
    contextStack.pop();
    return;
  }

  contextStack.pop();
}

export function getActiveAgentContext(): ActiveAgentContext | null {
  if (contextStack.length === 0) {
    return null;
  }
  return contextStack[contextStack.length - 1];
}
