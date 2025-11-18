import type { StyledText } from "@opentui/core";
import type { MessageContent } from "../agent";
import type { Config } from "../config";
import type { ExplainResult } from "../explain";

/**
 * Represents a rendered message part (text, tool call, etc.)
 * User messages and separators use appendOutput for proper StyledText handling.
 */
export interface MessagePart {
  id: string;
  type: "text" | "tool";
  content: string;
  metadata?: any;
}

/**
 * Represents a rendered message part (text, tool call, etc.)
 * Text-type parts get markdown rendering via tree-sitter
 */
export interface MessagePart {
  id: string;
  type: "text" | "tool";
  content: string;
  metadata?: any;
}

/**
 * UI abstraction interface for Yeet.
 * Allows different frontend implementations (TUI, Web, etc.) while sharing the same backend logic.
 */
export interface UIAdapter {
  // UI state
  conversationHistory: Array<{
    role: "user" | "assistant";
    content: MessageContent;
  }>;
  imageAttachments: Array<{
    mimeType: string;
    data: string;
    name?: string;
  }>;
  currentTokens: number;
  currentSessionId: string | null;
  pendingMapleSetup?: {
    modelId: string;
  };
  pendingOAuthSetup?: {
    verifier: string;
    provider?: "anthropic" | "openai";
    state?: string;
  };
  isGenerating: boolean;
  abortController: AbortController | null;

  // Core UI operations
  appendOutput(text: string | StyledText): void;
  addMessagePart(part: MessagePart): void;
  clearOutput(): void;
  setStatus(text: string): void;
  clearInput(): void;
  clearAttachments(): void;
  updateTokenCount(): void;
  saveCurrentSession(): void;
  setBackgroundColor?(color: string): void;
  updateHistoryConfig?(updates: {
    showMetadata?: boolean;
    inlineDiffs?: boolean;
    verboseTools?: boolean;
  }): void;

  // Modal selectors
  showSessionSelector?(): void;
  showModelSelector?(): void;
  showExplainReview?(result: ExplainResult): void;

  // Input handling
  onUserInput(callback: (message: string) => Promise<void>): void;
  onCommand(callback: (command: string, args: string[]) => Promise<void>): void;

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Factory function type for creating UI adapters.
 */
export type UIAdapterFactory = (config: Config) => Promise<UIAdapter>;
