import type { MessageContent } from "../agent";
import type { Config } from "../config";

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
  }>;
  currentTokens: number;
  currentSessionId: string | null;
  pendingMapleSetup?: {
    modelId: string;
  };

  // Core UI operations
  appendOutput(text: string): void;
  clearOutput(): void;
  setStatus(text: string): void;
  clearInput(): void;
  clearAttachments(): void;
  updateTokenCount(): void;
  saveCurrentSession(): void;

  // Session management
  showSessionSelector?(): void;

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
