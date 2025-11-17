import { runAgent } from "../agent";
import type { MessageContent } from "../agent";
import type { Config } from "../config";
import type { AgentCapability, AgentProfileConfig } from "../config";
import type { WorkspacePolicy } from "../config";
import { createSession, saveSession } from "../sessions";
import { resolveWorkspaceBinding } from "../workspace/binding";
import { popWorkspaceBinding, pushWorkspaceBinding } from "../workspace/state";
import {
  getAgentSessionContext,
  updateAgentSessionStatus,
} from "./context-store";
import type { AgentInbox, InboxUpdate } from "./inbox";
import type { AgentRegistry } from "./registry";
import {
  popActiveAgentContext,
  pushActiveAgentContext,
} from "./runtime-context";
import type { AgentSessionStatus, SessionTrigger } from "./types";

export interface SpawnRequest {
  agentId: string;
  capability: AgentCapability;
  prompt: MessageContent;
  parentSessionId?: string;
  trigger?: SessionTrigger;
  workspacePolicy?: WorkspacePolicy;
  workingDirectory?: string;
}

export interface SpawnResult {
  sessionId: string;
  summary: string;
  status: AgentSessionStatus;
  error?: string;
}

export interface SpawnHandle {
  contextId: string;
  sessionId: string;
  cancel(): void;
  awaitResult(): Promise<SpawnResult>;
  getStatus(): AgentSessionStatus;
  onStatusChange(listener: (status: AgentSessionStatus) => void): () => void;
}

export class AgentSpawner {
  constructor(
    private readonly registry: AgentRegistry,
    private readonly inbox: AgentInbox,
    private readonly getConfig: () => Promise<Config>,
  ) {}

  async spawn(request: SpawnRequest): Promise<SpawnHandle> {
    const profile = this.registry.get(request.agentId);
    if (!profile) {
      throw new Error(`Unknown agent profile: ${request.agentId}`);
    }

    if (!profile.capabilities.includes(request.capability)) {
      throw new Error(
        `Agent "${request.agentId}" does not support capability "${request.capability}"`,
      );
    }

    const config = await this.getConfig();
    const workspace = resolveWorkspaceBinding({
      basePath: request.workingDirectory || process.cwd(),
      policy: request.workspacePolicy || profile.defaultWorkspace,
      label: `${profile.id}:${request.parentSessionId || "root"}`,
      defaultAllowWrites: profile.permissionOverrides?.allowWrites ?? true,
    });

    const session = createSession(profile.model, config.activeProvider, {
      parentId: request.parentSessionId,
      agentId: profile.id,
      agentCapability: request.capability,
      trigger: request.trigger,
      workspace,
      permissions: profile.permissionOverrides,
    });

    session.conversationHistory.push({
      role: "user",
      content: request.prompt,
    });
    saveSession(session);

    const context = getAgentSessionContext(session.id);
    if (!context) {
      throw new Error(`Failed to register session context for ${session.id}`);
    }

    const controller = new AbortController();
    let currentStatus: AgentSessionStatus = "pending";
    const statusListeners = new Set<(status: AgentSessionStatus) => void>();
    const notifyStatus = (status: AgentSessionStatus) => {
      currentStatus = status;
      for (const listener of statusListeners) {
        try {
          listener(status);
        } catch {
          // Ignore listener errors
        }
      }
    };

    const resultPromise = this.executeAgent({
      sessionId: session.id,
      profile,
      config,
      controller,
      onStatusChange: notifyStatus,
    });

    const handle: SpawnHandle = {
      contextId: context.sessionId,
      sessionId: session.id,
      cancel: () => controller.abort("cancelled"),
      awaitResult: () => resultPromise,
      getStatus: () => currentStatus,
      onStatusChange: (listener) => {
        statusListeners.add(listener);
        return () => statusListeners.delete(listener);
      },
    };

    notifyStatus("pending");
    this.inbox.push(this.createUpdate(session.id, profile, "pending"));
    return handle;
  }

  private async executeAgent(args: {
    sessionId: string;
    profile: AgentProfileConfig;
    config: Config;
    controller: AbortController;
    onStatusChange: (status: AgentSessionStatus) => void;
  }): Promise<SpawnResult> {
    const { sessionId, profile, controller, onStatusChange } = args;
    const { loadSession } = await import("../sessions");
    const session = loadSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const configForAgent = this.applyProfileModel(args.config, profile);
    const messageHistory = session.conversationHistory.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const binding =
      session.workspace ??
      resolveWorkspaceBinding({
        basePath: process.cwd(),
        policy: profile.defaultWorkspace,
      });
    if (!session.workspace) {
      session.workspace = binding;
      saveSession(session, { skipParentUpdate: true });
    }
    pushWorkspaceBinding(binding);
    const runtimeContext = {
      sessionId,
      agentId: profile.id,
      capability: (session.agentCapability ?? "subtask") as AgentCapability,
    };
    pushActiveAgentContext(runtimeContext);

    updateAgentSessionStatus(sessionId, "running");
    onStatusChange("running");
    this.inbox.push(this.createUpdate(sessionId, profile, "running"));

    let assistantBuffer = "";
    try {
      for await (const event of runAgent(
        messageHistory,
        configForAgent,
        undefined,
        configForAgent.maxSteps,
        controller.signal,
      )) {
        if (event.type === "text") {
          assistantBuffer += event.content || "";
        }
        if (event.type === "tool") {
          session.conversationHistory.push({
            role: "assistant",
            content: `[tool:${event.name}]`,
          });
        }
        if (event.type === "error") {
          throw new Error(event.error || "Agent error");
        }
      }

      if (assistantBuffer.trim()) {
        session.conversationHistory.push({
          role: "assistant",
          content: assistantBuffer.trim(),
        });
      }

      saveSession(session);
      updateAgentSessionStatus(sessionId, "complete");
      onStatusChange("complete");
      const summary =
        assistantBuffer.trim() || "Completed without textual output.";
      this.inbox.push(
        this.createUpdate(sessionId, profile, "complete", summary),
      );
      return { sessionId, summary, status: "complete" };
    } catch (error: any) {
      const status: AgentSessionStatus =
        controller.signal.aborted && error?.name === "AbortError"
          ? "waiting"
          : "error";
      updateAgentSessionStatus(sessionId, status);
      onStatusChange(status);
      this.inbox.push(
        this.createUpdate(
          sessionId,
          profile,
          status,
          undefined,
          error?.message,
        ),
      );
      return {
        sessionId,
        summary: "",
        status,
        error: error?.message || "Agent execution failed",
      };
    } finally {
      popActiveAgentContext(runtimeContext);
      popWorkspaceBinding();
    }
  }

  private createUpdate(
    sessionId: string,
    profile: AgentProfileConfig,
    status: AgentSessionStatus,
    summary?: string,
    error?: string,
  ): InboxUpdate {
    return {
      sessionId,
      agentId: profile.id,
      capability: profile.capabilities.join(","),
      status,
      summary,
      error,
      timestamp: new Date().toISOString(),
    };
  }

  private applyProfileModel(
    config: Config,
    profile: AgentProfileConfig,
  ): Config {
    const cloned = structuredClone(config);
    if (cloned.activeProvider === "opencode") {
      cloned.opencode = {
        ...cloned.opencode,
        model: profile.model,
      };
    } else if (cloned.activeProvider === "anthropic" && cloned.anthropic) {
      cloned.anthropic = {
        ...cloned.anthropic,
        model: profile.model,
      };
    } else if (cloned.activeProvider === "maple" && cloned.maple) {
      cloned.maple = {
        ...cloned.maple,
        model: profile.model,
      };
    }
    return cloned;
  }
}
