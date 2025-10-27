import { describe, expect, test } from "bun:test";
import { $ } from "bun";
import { readImageFromClipboard } from "../src/clipboard";

describe("Clipboard Image E2E", () => {
  test("should read image from clipboard end-to-end", async () => {
    // Create a small test PNG (1x1 red pixel)
    const redPixelPNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
      "base64",
    );

    // Save to temp file
    const testImagePath = "/tmp/yeet-test-image.png";
    await Bun.write(testImagePath, redPixelPNG);

    // Copy image to clipboard using AppleScript
    const script = `
      tell application "Finder"
        set imageFile to POSIX file "${testImagePath}" as alias
        set the clipboard to (read imageFile as «class PNGf»)
      end tell
    `;

    const copyResult = await $`osascript -e ${script}`.nothrow().quiet();

    if (copyResult.exitCode !== 0) {
      console.log(
        "⚠️  Skipping test: Could not copy image to clipboard (this is expected in CI environments)",
      );
      return;
    }

    // Wait a moment for clipboard to update
    await Bun.sleep(100);

    // Now read it back using our function
    const result = await readImageFromClipboard();

    // Verify we got the image
    expect(result).not.toBeNull();

    if (!result) {
      throw new Error("Result should not be null after expect check");
    }

    expect(result.data).toBeDefined();
    expect(result.data.length).toBeGreaterThan(50); // Base64 encoded PNG should be at least this long
    expect(result.mimeType).toBe("image/png");

    // Verify the data is valid base64
    const decoded = Buffer.from(result.data, "base64");
    expect(decoded.length).toBeGreaterThan(0);

    // Verify it's a PNG (starts with PNG signature)
    expect(decoded[0]).toBe(0x89);
    expect(decoded[1]).toBe(0x50); // P
    expect(decoded[2]).toBe(0x4e); // N
    expect(decoded[3]).toBe(0x47); // G

    console.log(
      "✓ Successfully copied and read image from clipboard:",
      result.data.length,
      "bytes base64",
    );
    console.log("✓ Decoded to", decoded.length, "bytes PNG");
  }, 10000); // 10 second timeout
});
