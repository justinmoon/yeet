/**
 * Shared history formatter for rendering conversation history.
 * Used by both TUI adapter and CLI replay to ensure consistent formatting.
 */

import { type StyledText, t } from "@opentui/core";
import { semantic } from "./colors";

/**
 * Constant spacer inserted between rendered history entries.
 * Provides visual breathing room without blank lines or separators.
 * Single space creates a minimal gap between entries.
 */
export const HISTORY_SPACER = " ";

/**
 * Role type for message formatting
 */
export type MessageRole = "user" | "assistant";

/**
 * Metadata for a history entry
 */
export interface HistoryMetadata {
  timestamp?: Date;
  tokenDelta?: number;
  duration?: number; // in milliseconds
}

/**
 * Attachment reference for inline display
 */
export interface AttachmentRef {
  type: "image" | "file";
  index: number; // 1-based index within the message
}

/**
 * Format a message line with role prefix and optional metadata.
 * Returns StyledText that can be appended to the output.
 *
 * @param role - "user" or "assistant"
 * @param text - The message content
 * @param metadata - Optional metadata (timestamp, token count, duration)
 * @param attachments - Optional attachment references
 * @param showMetadata - Whether to show metadata suffix
 */
export function formatMessageLine(
  role: MessageRole,
  text: string,
  metadata?: HistoryMetadata,
  attachments?: AttachmentRef[],
  showMetadata = true,
): StyledText {
  const sanitized = text.trimEnd();
  // Build prefix based on role
  const prefix =
    role === "user"
      ? semantic.historyUserPrefix("[you] ")
      : semantic.historyAgentPrefix("[yeet] ");

  // Build main content with attachments
  let content = sanitized;
  if (attachments && attachments.length > 0) {
    const attachmentTags = attachments
      .map((att) => `[${att.type}-${att.index}]`)
      .join(" ");
    content = `${text} ${attachmentTags}`;
  }

  // Build metadata suffix if enabled
  const metadataSuffix = showMetadata
    ? buildMetadataSuffix(metadata)
    : "";

  // Combine prefix + content + metadata
  return t`${prefix}${content}${metadataSuffix}\n`;
}

/**
 * Build metadata suffix for a history entry.
 * Returns styled text with timestamp, token delta, and optional duration.
 *
 * @param metadata - Metadata to format
 */
function buildMetadataSuffix(metadata?: HistoryMetadata): StyledText | string {
  if (!metadata) return "";

  const parts: string[] = [];

  // Timestamp in HH:MM format
  if (metadata.timestamp) {
    const hours = metadata.timestamp.getHours().toString().padStart(2, "0");
    const minutes = metadata.timestamp.getMinutes().toString().padStart(2, "0");
    parts.push(`${hours}:${minutes}`);
  }

  // Token delta
  if (metadata.tokenDelta !== undefined && metadata.tokenDelta > 0) {
    parts.push(`+${metadata.tokenDelta} tok`);
  }

  // Duration (if significant, > 1 second)
  if (metadata.duration !== undefined && metadata.duration > 1000) {
    const seconds = Math.round(metadata.duration / 1000);
    parts.push(`${seconds}s`);
  }

  if (parts.length === 0) return "";

  // Join with " · " separator and apply dim styling
  const suffix = " · " + parts.join(" · ");
  return semantic.historyMetadata(suffix);
}

/**
 * Tool call information for summary formatting
 */
export interface ToolCallInfo {
  name: string;
  args?: Record<string, any>;
  result?: {
    error?: string;
    success?: boolean;
    [key: string]: any;
  };
}

/**
 * Summary counts for tool output
 */
export interface ToolSummaryCounts {
  linesAdded?: number;
  linesRemoved?: number;
  totalLines?: number;
  exitCode?: number;
}

/**
 * Format a tool call summary in OpenCode style.
 * Returns StyledText that can be appended to the output.
 *
 * Examples:
 *   [edit] foo.ts +14/−2
 *   [bash] exit 0 · 12 lines
 *   [read] foo.ts · 6 lines
 *
 * @param tool - Tool call information
 * @param counts - Summary counts (lines, exit codes, etc.)
 * @param showMetadata - Whether to show metadata like line counts
 */
export function formatToolSummary(
  tool: ToolCallInfo,
  counts?: ToolSummaryCounts,
  showMetadata = true,
): StyledText {
  const toolPrefix = semantic.historyToolPrefix(`[${tool.name}] `);

  // Build tool-specific summary based on tool name
  let summary = "";

  switch (tool.name) {
    case "edit": {
      const path = tool.args?.path || tool.args?.file_path || "unknown";
      summary = path;

      if (showMetadata && counts) {
        const added = counts.linesAdded || 0;
        const removed = counts.linesRemoved || 0;
        if (added > 0 || removed > 0) {
          const addPart = semantic.historyDiffAdd(`+${added}`);
          const removePart = semantic.historyDiffRemove(`−${removed}`);
          return t`${toolPrefix}${summary} ${addPart}/${removePart}\n`;
        }
      }
      break;
    }

    case "bash": {
      const command = tool.args?.command || "";
      const exitCode = counts?.exitCode ?? tool.result?.exitCode ?? 0;
      summary = command;

      if (showMetadata) {
        const statusPart =
          exitCode === 0
            ? semantic.success(`exit ${exitCode}`)
            : semantic.error(`exit ${exitCode}`);
        const linesPart =
          counts?.totalLines !== undefined
            ? semantic.historyMetadata(` · ${counts.totalLines} lines`)
            : "";
        return t`${toolPrefix}${summary} ${statusPart}${linesPart}\n`;
      }
      break;
    }

    case "read":
    case "write": {
      const path = tool.args?.path || tool.args?.file_path || "unknown";
      summary = path;

      if (showMetadata && counts?.totalLines !== undefined) {
        const linesPart = semantic.historyMetadata(
          ` · ${counts.totalLines} lines`,
        );
        return t`${toolPrefix}${summary}${linesPart}\n`;
      }
      break;
    }

    case "search": {
      const pattern = tool.args?.pattern || "";
      const path = tool.args?.path;
      summary = `"${pattern}"${path ? ` in ${path}` : ""}`;
      break;
    }

  default:
      // Generic tool summary
      summary = JSON.stringify(tool.args || {});
  }

  summary = summary.trimEnd();

  // Ensure metadata is trimmed as well
  const summaryText =
    summary.length > 0 ? summary : JSON.stringify(tool.args || {});

  switch (tool.name) {
    case "edit":
    case "bash":
    case "read":
    case "write":
      // Already returned earlier with metadata
      break;
    default:
      // Generic tool summary
      return t`${toolPrefix}${summaryText}\n`;
  }

  return t`${toolPrefix}${summaryText}\n`;
}

/**
 * Get the spacer text to insert between history entries.
 * Returns the constant spacer string.
 */
export function getHistorySpacer(): string {
  return HISTORY_SPACER;
}

/**
 * Insert spacer between history entries.
 * Returns StyledText with just the spacer content.
 */
export function formatHistorySpacer(): StyledText {
  return t`${HISTORY_SPACER}`;
}
