import { describe, expect, test } from "bun:test";
import { interpretExplainKey, type ExplainKeyAction } from "../src/explain/keymap";

describe("interpretExplainKey", () => {
  const cases: Array<[
    { name?: string; key?: string; code?: string },
    ExplainKeyAction,
  ]> = [
    [{ name: "left" }, "previous"],
    [{ name: "up" }, "previous"],
    [{ name: "p" }, "previous"],
    [{ key: "ArrowLeft" }, "previous"],
    [{ name: "right" }, "next"],
    [{ name: "n" }, "next"],
    [{ code: "ArrowDown" }, "next"],
    [{ name: "escape" }, "close"],
    [{ name: "q" }, "close"],
    [{ key: "Escape" }, "close"],
    [{ name: "return" }, "submit"],
    [{ key: "Enter" }, "submit"],
    [{ name: "space" }, "none"],
  ];

  for (const [input, expected] of cases) {
    test(`maps ${JSON.stringify(input)} to ${expected}`, () => {
      expect(interpretExplainKey(input as any)).toBe(expected);
    });
  }
});
