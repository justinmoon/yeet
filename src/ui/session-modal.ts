import {
  BoxRenderable,
  type CliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { Session } from "../sessions";

export interface SessionListItem {
  id: string;
  name?: string;
  created: string;
  updated: string;
  model: string;
  totalMessages: number;
  preview?: string;
}

export class SessionSelectorModal {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private contentText: TextRenderable;
  private sessions: SessionListItem[];
  private selectedIndex = 0;
  private onSelect?: (sessionId: string) => void;
  private onCancel?: () => void;

  constructor(
    private renderer: CliRenderer,
    sessions: SessionListItem[],
  ) {
    this.sessions = sessions;

    // Create modal container (centered)
    this.container = new BoxRenderable(renderer, {
      id: "session-modal",
      border: true,
      borderStyle: "double",
      borderColor: "blue",
      padding: 1,
      zIndex: 1000,
      // Center the modal
      position: "absolute",
      top: 2,
      left: 4,
      right: 4,
      bottom: 2,
    });

    // Title
    const title = new TextRenderable(renderer, {
      id: "modal-title",
      content:
        "Select a Session (↑↓ to navigate, Enter to select, Esc to cancel)",
      fg: "blue",
      height: 1,
    });
    this.container.add(title);

    // Scrollable session list
    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: "modal-scroll",
      flexGrow: 1,
      flexShrink: 1,
      scrollY: true,
      scrollX: false,
      overflow: "hidden",
      stickyScroll: false,
    });
    this.container.add(this.scrollBox);

    this.contentText = new TextRenderable(renderer, {
      id: "modal-content",
      content: "",
    });
    this.scrollBox.add(this.contentText);

    this.render();
  }

  private render(): void {
    let content = "";

    for (let i = 0; i < this.sessions.length; i++) {
      const session = this.sessions[i];
      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? "→ " : "  ";

      const updated = new Date(session.updated);
      const timeAgo = this.getTimeAgo(updated);
      const name = session.name ? ` "${session.name}"` : "";

      content += `${prefix}${i + 1}. ${session.id}${name}\n`;
      content += `   ${session.model} • ${session.totalMessages} messages • ${timeAgo}\n`;

      if (session.preview) {
        const preview =
          session.preview.length > 80
            ? session.preview.substring(0, 77) + "..."
            : session.preview;
        content += `   Preview: ${preview}\n`;
      }

      content += "\n";
    }

    if (this.sessions.length === 0) {
      content = "No saved sessions found.";
    }

    this.contentText.content = content;

    // Scroll to selected item
    const lineHeight = 4; // Approximate lines per session
    const targetScroll = this.selectedIndex * lineHeight;
    // @ts-ignore
    const viewportHeight = this.scrollBox.viewport?.height || 10;
    const currentScroll = this.scrollBox.scrollTop;

    // Auto-scroll to keep selected item visible
    if (targetScroll < currentScroll) {
      this.scrollBox.scrollTop = targetScroll;
    } else if (targetScroll > currentScroll + viewportHeight - lineHeight) {
      this.scrollBox.scrollTop = targetScroll - viewportHeight + lineHeight;
    }
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
    this.container.visible = true;
    // @ts-ignore
    this.renderer.root.add(this.container);
  }

  hide(): void {
    this.container.visible = false;
    this.container.zIndex = -9999;
    // @ts-ignore - remove from root by ID
    this.renderer.root.remove(this.container.id);
  }

  moveUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.render();
      // @ts-ignore
      this.renderer.requestAnimationFrame?.(() => {});
    }
  }

  moveDown(): void {
    if (this.selectedIndex < this.sessions.length - 1) {
      this.selectedIndex++;
      this.render();
      // @ts-ignore
      this.renderer.requestAnimationFrame?.(() => {});
    }
  }

  selectCurrent(): void {
    if (this.sessions.length > 0 && this.onSelect) {
      const selected = this.sessions[this.selectedIndex];
      this.onSelect(selected.id);
    }
  }

  cancel(): void {
    if (this.onCancel) {
      this.onCancel();
    }
  }

  setOnSelect(callback: (sessionId: string) => void): void {
    this.onSelect = callback;
  }

  setOnCancel(callback: () => void): void {
    this.onCancel = callback;
  }
}
