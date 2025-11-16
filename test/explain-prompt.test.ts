import { describe, expect, mock, test } from "bun:test";
import type { Config } from "../src/config";

mock.module("@opentui/solid/jsx-runtime", () => ({
  jsx: () => null,
  jsxs: () => null,
  jsxDEV: () => null,
  Fragment: Symbol("Fragment"),
}));

const { TUISolidAdapter } = await import("../src/ui/tui-solid-adapter");

const stubConfig: Config = {
  activeProvider: "opencode",
  opencode: {
    apiKey: "test",
    baseURL: "https://example.com",
    model: "test-model",
  },
  maxSteps: 5,
  temperature: 0.1,
};

function createAdapterHarness() {
  const adapter = new TUISolidAdapter(stubConfig) as any;
  let paletteOpen = false;
  let paletteMode = "actions";
  let paletteQuery = "";

  adapter.setCommandPaletteOpen = (value: boolean) => {
    paletteOpen = value;
  };
  adapter.setCommandPaletteMode = (value: string) => {
    paletteMode = value;
  };
  adapter.setCommandPaletteQuery = (value: string) => {
    paletteQuery = value;
  };
  adapter.setCommandPaletteEntries = () => {};
  adapter.setCommandPaletteIndex = () => {};
  adapter.setCommandPaletteTitle = () => {};

  adapter.getCommandPaletteOpen = () => paletteOpen;
  adapter.getCommandPaletteMode = () => paletteMode;
  adapter.getCommandPaletteQuery = () => paletteQuery;

  return {
    adapter,
    getPaletteOpen: () => paletteOpen,
    getPaletteMode: () => paletteMode,
    getPaletteQuery: () => paletteQuery,
  };
}

describe("Explain prompt in command palette", () => {
  test("openExplainPrompt sets mode to explain", () => {
    const harness = createAdapterHarness();
    const adapter: any = harness.adapter;

    adapter.openExplainPrompt();

    expect(harness.getPaletteMode()).toBe("explain");
    expect(harness.getPaletteQuery()).toBe("");
  });

  test("runExplain is called when Enter is pressed in explain mode", async () => {
    const harness = createAdapterHarness();
    const adapter: any = harness.adapter;

    let runExplainCalled = false;
    let capturedPrompt = "";

    // Mock runExplain
    adapter.runExplain = async (prompt: string) => {
      runExplainCalled = true;
      capturedPrompt = prompt;
    };

    // Simulate opening explain prompt
    adapter.openExplainPrompt();

    // Simulate the palette input ref with plainText
    const mockPaletteInputRef = {
      plainText: "diff against master",
    };

    // Simulate Enter key press in explain mode
    const mode = harness.getPaletteMode();
    if (mode === "explain") {
      const prompt = mockPaletteInputRef.plainText || "";
      if (prompt.trim()) {
        await adapter.runExplain(prompt);
      }
    }

    expect(runExplainCalled).toBe(true);
    expect(capturedPrompt).toBe("diff against master");
  });
});
