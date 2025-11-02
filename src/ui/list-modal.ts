import {
  BoxRenderable,
  type CliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";

export interface ListModalItem {
  id: string;
  lines: string[]; // Each item can have multiple lines
}

export interface ListModalOptions {
  title: string;
  emptyMessage?: string;
  itemHeight?: number; // Lines per item (default: 4)
}

/**
 * Generic reusable modal for displaying a selectable list
 */
export class ListModal<T extends ListModalItem> {
  private container: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private contentText: TextRenderable;
  private items: T[];
  private selectedIndex = 0;
  private onSelect?: (item: T) => void;
  private onCancel?: () => void;
  private options: Required<ListModalOptions>;

  constructor(
    private renderer: CliRenderer,
    items: T[],
    options: ListModalOptions,
  ) {
    this.items = items;
    this.options = {
      emptyMessage: "No items found.",
      itemHeight: 4,
      ...options,
    };

    // Create modal container (centered)
    this.container = new BoxRenderable(renderer, {
      id: "list-modal",
      border: true,
      borderStyle: "double",
      borderColor: "blue",
      padding: 1,
      zIndex: 1000,
      position: "absolute",
      top: 2,
      left: 4,
      right: 4,
      bottom: 2,
    });

    // Title
    const title = new TextRenderable(renderer, {
      id: "modal-title",
      content: this.options.title,
      fg: "blue",
      height: 1,
    });
    this.container.add(title);

    // Scrollable list
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
    if (this.items.length === 0) {
      this.contentText.content = this.options.emptyMessage;
      return;
    }

    let content = "";

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const isSelected = i === this.selectedIndex;
      const prefix = isSelected ? "→ " : "  ";

      // First line with prefix
      content += `${prefix}${item.lines[0]}\n`;

      // Subsequent lines indented
      for (let j = 1; j < item.lines.length; j++) {
        content += `   ${item.lines[j]}\n`;
      }

      content += "\n";
    }

    this.contentText.content = content;

    // Auto-scroll to keep selected item visible
    const lineHeight = this.options.itemHeight;
    const targetScroll = this.selectedIndex * lineHeight;
    // @ts-ignore
    const viewportHeight = this.scrollBox.viewport?.height || 10;
    const currentScroll = this.scrollBox.scrollTop;

    if (targetScroll < currentScroll) {
      this.scrollBox.scrollTop = targetScroll;
    } else if (targetScroll > currentScroll + viewportHeight - lineHeight) {
      this.scrollBox.scrollTop = targetScroll - viewportHeight + lineHeight;
    }
  }

  show(): void {
    this.container.visible = true;
    // @ts-ignore
    this.renderer.root.add(this.container);
  }

  hide(): void {
    this.container.visible = false;
    this.container.zIndex = -9999;
    // @ts-ignore
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
    if (this.selectedIndex < this.items.length - 1) {
      this.selectedIndex++;
      this.render();
      // @ts-ignore
      this.renderer.requestAnimationFrame?.(() => {});
    }
  }

  selectCurrent(): void {
    if (this.items.length > 0 && this.onSelect) {
      const selected = this.items[this.selectedIndex];
      this.onSelect(selected);
    }
  }

  cancel(): void {
    if (this.onCancel) {
      this.onCancel();
    }
  }

  setOnSelect(callback: (item: T) => void): void {
    this.onSelect = callback;
  }

  setOnCancel(callback: () => void): void {
    this.onCancel = callback;
  }
}
