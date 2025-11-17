// Tool call cache for Codex stateless operation
// Stores function calls so we can inject them in subsequent requests

export type CachedToolCall = {
  call_id: string;
  name: string;
  arguments: string; // JSON string
};

// Keep this scoped by session/conversation
const callCache = new Map<string, Map<string, CachedToolCall>>();

export function upsertToolCall(sessionId: string, call: CachedToolCall) {
  const bucket = callCache.get(sessionId) ?? new Map<string, CachedToolCall>();
  bucket.set(call.call_id, call);
  callCache.set(sessionId, bucket);
}

export function getToolCall(
  sessionId: string,
  callId: string,
): CachedToolCall | undefined {
  return callCache.get(sessionId)?.get(callId);
}

export function clearSession(sessionId: string) {
  callCache.delete(sessionId);
}

// Search across all sessions for a tool call by call_id
// This is needed because the fetch transformer doesn't have direct access to sessionId
export function getToolCallByCallId(
  callId: string,
): CachedToolCall | undefined {
  for (const [, sessionMap] of callCache) {
    const call = sessionMap.get(callId);
    if (call) return call;
  }
  return undefined;
}
