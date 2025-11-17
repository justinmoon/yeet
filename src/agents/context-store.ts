import type { AgentSessionContext, AgentSessionStatus } from "./types";

const contexts = new Map<string, AgentSessionContext>();

export function upsertAgentSessionContext(
  context: AgentSessionContext,
): AgentSessionContext {
  contexts.set(context.sessionId, context);
  return context;
}

export function updateAgentSessionStatus(
  sessionId: string,
  status: AgentSessionStatus,
): void {
  const ctx = contexts.get(sessionId);
  if (!ctx) return;
  ctx.status = status;
  ctx.updatedAt = new Date().toISOString();
}

export function getAgentSessionContext(
  sessionId: string,
): AgentSessionContext | undefined {
  return contexts.get(sessionId);
}

export function listAgentSessionContexts(): AgentSessionContext[] {
  return Array.from(contexts.values());
}

export function removeAgentSessionContext(sessionId: string): void {
  contexts.delete(sessionId);
}
