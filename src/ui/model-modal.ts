import type { CliRenderer } from "@opentui/core";
import type { Config } from "../config";
import type { ModelInfo } from "../models/registry";
import { ListModal, type ListModalItem } from "./list-modal";

interface ModelModalItem extends ListModalItem {
  modelId: string;
  provider: string;
}

export class ModelSelectorModal {
  private modal: ListModal<ModelModalItem>;

  constructor(renderer: CliRenderer, models: ModelInfo[], config: Config) {
    // Group models by provider
    const groupedModels: { provider: string; models: ModelInfo[] }[] = [];
    const providers = Array.from(new Set(models.map((m) => m.provider)));

    for (const provider of providers) {
      const providerModels = models.filter((m) => m.provider === provider);
      if (providerModels.length > 0) {
        groupedModels.push({ provider, models: providerModels });
      }
    }

    // Convert to modal items with provider headers
    const items: ModelModalItem[] = [];
    let index = 0;

    // Determine current model
    const currentModel =
      config.activeProvider === "anthropic"
        ? config.anthropic?.model
        : config.activeProvider === "maple"
          ? config.maple?.model
          : config.opencode.model;

    for (const group of groupedModels) {
      // Add provider header
      const providerName =
        group.provider === "anthropic"
          ? "Anthropic"
          : group.provider === "maple"
            ? "Maple AI"
            : "OpenCode";

      items.push({
        id: `header-${group.provider}`,
        modelId: "",
        provider: group.provider,
        lines: [`━━━ ${providerName} ━━━`],
      });

      // Add models under this provider
      for (const model of group.models) {
        index++;
        const isCurrent = model.id === currentModel;
        const currentMark = isCurrent ? " ★" : "";

        items.push({
          id: model.id,
          modelId: model.id,
          provider: group.provider,
          lines: [
            `${index}. ${model.name}${currentMark}`,
            `   ${model.id}`,
            `   ${model.pricing} • ${model.contextWindow.toLocaleString()} tokens`,
          ],
        });
      }

      // Add spacing between providers
      items.push({
        id: `spacer-${group.provider}`,
        modelId: "",
        provider: group.provider,
        lines: [""],
      });
    }

    this.modal = new ListModal(renderer, items, {
      title: "Select a Model (↑↓ to navigate, Enter to select, Esc to cancel)",
      emptyMessage: "No models available. Please configure authentication.",
      itemHeight: 4,
    });

    // Override selectCurrent to skip headers and spacers
    const originalSelectCurrent = this.modal.selectCurrent.bind(this.modal);
    this.modal.selectCurrent = () => {
      // Get selected item directly from modal
      const selectedItem = (this.modal as any).items?.[
        (this.modal as any).selectedIndex
      ];
      if (
        selectedItem?.modelId &&
        !selectedItem.id.startsWith("header-") &&
        !selectedItem.id.startsWith("spacer-")
      ) {
        originalSelectCurrent();
      }
    };
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

  setOnSelect(callback: (modelId: string) => void): void {
    this.modal.setOnSelect((item) => {
      if (item.modelId) {
        callback(item.modelId);
      }
    });
  }

  setOnCancel(callback: () => void): void {
    this.modal.setOnCancel(callback);
  }
}
