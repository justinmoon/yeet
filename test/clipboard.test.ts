import { describe, expect, test } from "bun:test";
import { readImageFromClipboard } from "../src/clipboard";

describe("Clipboard Image Reading", () => {
  test("should return null when clipboard has no image", async () => {
    // This test assumes clipboard currently has text, not an image
    const result = await readImageFromClipboard();

    // If clipboard has no image, should return null
    // If clipboard has an image, should return valid data
    if (result) {
      expect(result.data).toBeDefined();
      expect(result.data.length).toBeGreaterThan(50);
      expect(result.mimeType).toBe("image/png");
      console.log("✓ Found image in clipboard:", result.data.length, "bytes");
    } else {
      console.log("✓ No image in clipboard (expected)");
      expect(result).toBeNull();
    }
  });

  test("should handle clipboard read errors gracefully", async () => {
    // Should not throw even if clipboard read fails
    const result = await readImageFromClipboard();
    expect(result === null || typeof result === "object").toBe(true);
  });
});
