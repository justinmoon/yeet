import { describe, expect, mock, test } from "bun:test";
import type { Config } from "../src/config";

mock.module("@opentui/solid/jsx-runtime", () => ({
  jsx: () => null,
  jsxs: () => null,
  jsxDEV: () => null,
  Fragment: Symbol("Fragment"),
}));

const { TUISolidAdapter } = await import("../src/ui/tui-solid-adapter");
const { createStubExplainResult } = await import("../src/explain");

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

const stubIntent = {
  prompt: "stub",
  cwd: "/tmp/stub",
  base: "main",
  head: "feature",
};

function createAdapterHarness() {
  const adapter = new TUISolidAdapter(stubConfig) as any;
  let signalIndex = 0;
  let renderCount = 0;

  adapter.setStatusText = () => {};
  adapter.setOutputContent = () => {};
  adapter.setExplainVisible = () => {};
  adapter.setExplainResult = () => {};
  adapter.setExplainIndex = (value: number | ((prev: number) => number)) => {
    if (typeof value === "function") {
      signalIndex = value(signalIndex);
    } else {
      signalIndex = value;
    }
  };
  adapter.getExplainResult = () => adapter.explainState.result;
  adapter.getExplainIndex = () => signalIndex;
  adapter.renderer = {
    requestRender: () => {
      renderCount += 1;
    },
  };

  return {
    adapter,
    getSignalIndex: () => signalIndex,
    getRenderCount: () => renderCount,
    resetRenderCount: () => {
      renderCount = 0;
    },
  };
}

describe("TUISolidAdapter explain navigation", () => {
  test("navigates forward and backward with arrow keys", () => {
    const harness = createAdapterHarness();
    const adapter: any = harness.adapter;
    const result = createStubExplainResult(stubIntent);
    adapter.showExplainReview(result);

    expect(adapter.explainState.index).toBe(0);
    expect(harness.getSignalIndex()).toBe(0);

    let rightPrevented = 0;
    const rightEvent = {
      name: "right",
      key: "ArrowRight",
      code: "ArrowRight",
      preventDefault: () => {
        rightPrevented += 1;
      },
    };
    adapter.processExplainKeyEvent(rightEvent);

    expect(adapter.explainState.index).toBe(1);
    expect(harness.getSignalIndex()).toBe(1);
    expect(harness.getRenderCount()).toBe(1);
    expect(rightPrevented).toBe(1);

    let leftPrevented = 0;
    const leftEvent = {
      name: "left",
      key: "ArrowLeft",
      code: "ArrowLeft",
      preventDefault: () => {
        leftPrevented += 1;
      },
    };
    adapter.processExplainKeyEvent(leftEvent);

    expect(adapter.explainState.index).toBe(0);
    expect(harness.getSignalIndex()).toBe(0);
    expect(harness.getRenderCount()).toBe(2);
    expect(leftPrevented).toBe(1);
  });

  test("close key hides the explain view", () => {
    const harness = createAdapterHarness();
    const adapter: any = harness.adapter;
    const result = createStubExplainResult(stubIntent);

    let hideCalls = 0;
    adapter.hideExplainReview = () => {
      hideCalls += 1;
      adapter.explainModalActive = false;
      adapter.explainState.result = null;
      adapter.explainState.index = 0;
    };

    adapter.showExplainReview(result);
    expect(adapter.explainModalActive).toBe(true);

    let preventCount = 0;
    adapter.processExplainKeyEvent({
      name: "escape",
      key: "escape",
      code: "escape",
      preventDefault: () => {
        preventCount += 1;
      },
    });

    expect(hideCalls).toBe(1);
    expect(adapter.explainModalActive).toBe(false);
    expect(preventCount).toBe(1);
  });

  test("ignores navigation when explain view inactive", () => {
    const harness = createAdapterHarness();
    const adapter: any = harness.adapter;
    const result = createStubExplainResult(stubIntent);
    adapter.showExplainReview(result);
    adapter.explainModalActive = false;
    harness.resetRenderCount();

    let preventCalls = 0;
    adapter.processExplainKeyEvent({
      name: "right",
      key: "ArrowRight",
      code: "ArrowRight",
      preventDefault: () => {
        preventCalls += 1;
      },
    });

    expect(adapter.explainState.index).toBe(0);
    expect(harness.getSignalIndex()).toBe(0);
    expect(harness.getRenderCount()).toBe(0);
    expect(preventCalls).toBe(0);
  });
});
