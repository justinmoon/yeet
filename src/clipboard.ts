import { tmpdir } from "os";
import { join } from "path";
import { $ } from "bun";
import { mkdtemp, rm } from "fs/promises";

export interface ClipboardImage {
  data: string; // base64 encoded
  mimeType: string;
}

/**
 * Read image from clipboard (macOS only for now)
 * Returns base64 encoded image data if available
 */
export async function readImageFromClipboard(): Promise<ClipboardImage | null> {
  let tempDir: string | null = null;

  try {
    // Create temp directory
    tempDir = await mkdtemp(join(tmpdir(), "yeet-clipboard-"));
    const tempFile = join(tempDir, "image.png");

    // Use osascript to write clipboard image to file
    const script = `
      tell application "System Events"
        try
          set theImage to the clipboard as «class PNGf»
        on error
          return "error"
        end try
      end tell
      
      try
        set imageFile to POSIX file "${tempFile}"
        set fileRef to open for access imageFile with write permission
        write theImage to fileRef
        close access fileRef
        return "success"
      on error
        try
          close access fileRef
        end try
        return "error"
      end try
    `;

    const result = await $`osascript -e ${script}`.nothrow().quiet();

    if (
      result.exitCode !== 0 ||
      result.stdout.toString().trim() !== "success"
    ) {
      return null;
    }

    // Read the file and encode to base64
    const imageFile = Bun.file(tempFile);
    if (!(await imageFile.exists())) {
      return null;
    }

    const buffer = await imageFile.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString("base64");

    // Verify we got actual image data (minimum valid PNG is ~67 bytes)
    if (!base64Data || base64Data.length < 50) {
      return null;
    }

    return {
      data: base64Data,
      mimeType: "image/png",
    };
  } catch (error) {
    // Silently fail - clipboard might not have image data
    return null;
  } finally {
    // Cleanup temp directory
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
