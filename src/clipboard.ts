import { tmpdir, platform, release } from "os";
import { join } from "path";
import { $ } from "bun";
import { mkdtemp, rm } from "fs/promises";

export interface ClipboardImage {
  data: string; // base64 encoded
  mimeType: string;
}

export async function readImageFromClipboard(): Promise<ClipboardImage | null> {
  const os = platform();

  if (os === "darwin") {
    return readImageFromMacClipboard();
  }

  if (os === "win32" || release().toLowerCase().includes("microsoft")) {
    return readImageFromWindowsClipboard();
  }

  if (os === "linux") {
    return readImageFromLinuxClipboard();
  }

  return null;
}

async function readImageFromMacClipboard(): Promise<ClipboardImage | null> {
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

async function readImageFromWindowsClipboard(): Promise<ClipboardImage | null> {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img) {
  $ms = New-Object System.IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  [System.Convert]::ToBase64String($ms.ToArray())
}`;

  try {
    const result = await $`powershell.exe -command ${script}`.nothrow().text();
    const trimmed = result.trim();
    if (!trimmed) {
      return null;
    }

    return {
      data: trimmed,
      mimeType: "image/png",
    };
  } catch {
    return null;
  }
}

async function readImageFromLinuxClipboard(): Promise<ClipboardImage | null> {
  // Prefer wl-paste (Wayland)
  if (Bun.which("wl-paste")) {
    const buffer = await $`wl-paste -t image/png`.nothrow().arrayBuffer();
    if (buffer && buffer.byteLength > 0) {
      return {
        data: Buffer.from(buffer).toString("base64"),
        mimeType: "image/png",
      };
    }
  }

  // Fall back to xclip (X11)
  if (Bun.which("xclip")) {
    const buffer = await $`xclip -selection clipboard -t image/png -o`
      .nothrow()
      .arrayBuffer();
    if (buffer && buffer.byteLength > 0) {
      return {
        data: Buffer.from(buffer).toString("base64"),
        mimeType: "image/png",
      };
    }
  }

  return null;
}
