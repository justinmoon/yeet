import { homedir, platform } from "os";
import { fileURLToPath } from "url";
import { stat } from "fs/promises";
import path from "path";

export interface EncodedImage {
  mimeType: string;
  data: string;
  name?: string;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".tif",
  ".tiff",
  ".svg",
  ".heic",
  ".heif",
]);

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15MB safety cap

/**
 * Normalize pasted text that might represent a filesystem path.
 *
 * Supports:
 *  - file:// URLs
 *  - shell quoted strings (single or double quotes)
 *  - escaped spaces (\\ )
 *  - Windows drive/UNC paths
 *
 * Returns the normalized string, or null if the text doesn't look like a path.
 */
export function normalizePastedPath(raw: string): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/\r|\n/.test(trimmed)) {
    return null;
  }

  // file:// URL
  try {
    const possibleUrl = new URL(trimmed);
    if (possibleUrl.protocol === "file:") {
      return fileURLToPath(possibleUrl);
    }
  } catch {
    // Not a URL - ignore
  }

  const unquoted = stripMatchingQuotes(trimmed);
  const unescaped = unquoted.replace(/\\ /g, " ");

  if (!looksLikePathCandidate(unescaped)) {
    return null;
  }

  return unescaped;
}

/**
 * Attempt to read an image file from disk given a pasted path.
 * Ensures the file exists, is not excessively large, and looks like an image.
 */
export async function readImageFromPath(
  candidatePath: string,
): Promise<EncodedImage | null> {
  let normalized = candidatePath;
  if (!path.isAbsolute(normalized)) {
    normalized = normalized.startsWith("~/")
      ? path.join(homedir(), normalized.slice(2))
      : normalized.startsWith("~\\")
        ? path.join(homedir(), normalized.slice(2))
        : normalized.startsWith("~")
          ? path.join(homedir(), normalized.slice(1))
          : path.resolve(process.cwd(), normalized);
  }

  try {
    const stats = await stat(normalized);
    if (!stats.isFile()) {
      return null;
    }
    if (stats.size <= 0 || stats.size > MAX_ATTACHMENT_BYTES) {
      return null;
    }
  } catch {
    return null;
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return null;
  }

  const file = Bun.file(normalized);
  const buffer = await file.arrayBuffer().catch(() => null);
  if (!buffer) {
    return null;
  }

  const mimeType =
    file.type || MIME_BY_EXTENSION[ext] || "application/octet-stream";

  return {
    mimeType,
    data: Buffer.from(buffer).toString("base64"),
    name: path.basename(normalized),
  };
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    const inner = value.slice(1, -1);
    if (first === "'") {
      return inner.replace(/\\'/g, "'");
    }
    return inner.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

function looksLikePathCandidate(value: string): boolean {
  if (!value) return false;
  if (value === "." || value === "..") return false;

  if (/^[a-zA-Z]:[\\/]/.test(value)) {
    return true;
  }

  if (value.startsWith("\\\\")) {
    return true;
  }

  if (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    value.startsWith("~\\")
  ) {
    return true;
  }

  if (value.includes("/") || value.includes("\\")) {
    return true;
  }

  const ext = path.extname(value).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) {
    return true;
  }

  // WSL file paths (\\wsl$)
  if (platform() === "win32" && value.startsWith("\\\\wsl$")) {
    return true;
  }

  return false;
}
