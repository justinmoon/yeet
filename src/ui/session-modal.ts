import type { CliRenderer } from "@opentui/core";
import { ListModal, type ListModalItem } from "./list-modal";

export interface SessionListItem {
  id: string;
  name?: string;
  created: string;
  updated: string;
  model: string;
  totalMessages: number;
  preview?: string;
}

interface SessionModalItem extends ListModalItem {
  sessionId: string;
}

export class SessionSelectorModal {
  private modal: ListModal<SessionModalItem>;

  constructor(renderer: CliRenderer, sessions: SessionListItem[]) {
    // Convert sessions to modal items
    const items: SessionModalItem[] = sessions.map((session, i) => {
      const updated = new Date(session.updated);
      const timeAgo = this.getTimeAgo(updated);
      const name = session.name ? ` "${session.name}"` : "";

      const lines = [
        `${i + 1}. ${session.id}${name}`,
        `${session.model} • ${session.totalMessages} messages • ${timeAgo}`,
      ];

      if (session.preview) {
        const preview =
          session.preview.length > 80
            ? session.preview.substring(0, 77) + "..."
            : session.preview;
        lines.push(`Preview: ${preview}`);
      }

      return {
        id: session.id,
        sessionId: session.id,
        lines,
      };
    });

    this.modal = new ListModal(renderer, items, {
      title: "Select a Session (↑↓ to navigate, Enter to select, Esc to cancel)",
      emptyMessage: "No saved sessions found.",
      itemHeight: 4,
    });
  }

  private getTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 2592000)}mo ago`;
  }

  show(): void {
    this.modal.show();
  }

  hide(): void {
    this.modal.hide();
  }

  moveUp(): void {
    this.modal.moveUp();
  }

  moveDown(): void {
    this.modal.moveDown();
  }

  selectCurrent(): void {
    this.modal.selectCurrent();
  }

  cancel(): void {
    this.modal.cancel();
  }

  setOnSelect(callback: (sessionId: string) => void): void {
    this.modal.setOnSelect((item) => callback(item.sessionId));
  }

  setOnCancel(callback: () => void): void {
    this.modal.setOnCancel(callback);
  }
}
