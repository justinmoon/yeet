/**
 * Codex instructions fetcher
 * Fetches the official Codex prompt from GitHub with ETag-based caching
 * Based on opencode-openai-codex-auth implementation
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { YEET_CONFIG_DIR } from "./config";
import { logger } from "./logger";

// GitHub API and Codex instructions URLs
const GITHUB_API_RELEASES =
  "https://api.github.com/repos/openai/codex/releases/latest";
const CACHE_DIR = join(YEET_CONFIG_DIR, "cache");
const CACHE_FILE = join(CACHE_DIR, "codex-instructions.md");
const CACHE_METADATA_FILE = join(CACHE_DIR, "codex-instructions-meta.json");

// Rate limit protection: Only check GitHub if cache is older than 15 minutes
const CACHE_TTL_MS = 15 * 60 * 1000;

interface GitHubRelease {
  tag_name: string;
}

interface CacheMetadata {
  etag: string | null;
  tag: string;
  lastChecked: number;
  url: string;
}

/**
 * Get the latest release tag from GitHub
 */
async function getLatestReleaseTag(): Promise<string> {
  const response = await fetch(GITHUB_API_RELEASES);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest release: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as GitHubRelease;
  return data.tag_name;
}

/**
 * Fetch Codex instructions from GitHub with ETag-based caching
 *
 * This function:
 * - Checks cache age (returns cached if < 15 minutes old)
 * - Fetches latest release tag from GitHub
 * - Uses HTTP conditional requests (If-None-Match) to check for updates
 * - Caches instructions locally with metadata
 * - Falls back to cached version on network errors
 *
 * @returns Codex instructions markdown text
 */
export async function getCodexInstructions(): Promise<string> {
  try {
    // Load cached metadata (includes ETag, tag, and lastChecked timestamp)
    let cachedETag: string | null = null;
    let cachedTag: string | null = null;
    let cachedTimestamp: number | null = null;

    if (existsSync(CACHE_METADATA_FILE)) {
      try {
        const metadataText = await readFile(CACHE_METADATA_FILE, "utf-8");
        const metadata = JSON.parse(metadataText) as CacheMetadata;
        cachedETag = metadata.etag;
        cachedTag = metadata.tag;
        cachedTimestamp = metadata.lastChecked;
      } catch (error) {
        logger.warn("Failed to parse cache metadata", {
          error: String(error),
        });
      }
    }

    // Rate limit protection: If cache is less than 15 minutes old, use it
    if (
      cachedTimestamp &&
      Date.now() - cachedTimestamp < CACHE_TTL_MS &&
      existsSync(CACHE_FILE)
    ) {
      logger.debug("Using cached Codex instructions (cache is fresh)");
      return await readFile(CACHE_FILE, "utf-8");
    }

    // Get the latest release tag (only if cache is stale or missing)
    logger.debug("Checking for latest Codex release tag");
    const latestTag = await getLatestReleaseTag();
    const instructionsUrl = `https://raw.githubusercontent.com/openai/codex/${latestTag}/codex-rs/core/gpt_5_codex_prompt.md`;

    logger.info("Fetching Codex instructions", {
      tag: latestTag,
      url: instructionsUrl,
    });

    // If tag changed, we need to fetch new instructions
    if (cachedTag !== latestTag) {
      logger.info("New Codex release detected", {
        old: cachedTag,
        new: latestTag,
      });
      cachedETag = null; // Force re-fetch
    }

    // Make conditional request with If-None-Match header
    const headers: Record<string, string> = {};
    if (cachedETag) {
      headers["If-None-Match"] = cachedETag;
    }

    const response = await fetch(instructionsUrl, { headers });

    // 304 Not Modified - our cached version is still current
    if (response.status === 304) {
      logger.debug("Codex instructions not modified (304)");
      if (existsSync(CACHE_FILE)) {
        // Update lastChecked timestamp
        await mkdir(CACHE_DIR, { recursive: true });
        await writeFile(
          CACHE_METADATA_FILE,
          JSON.stringify({
            etag: cachedETag,
            tag: latestTag,
            lastChecked: Date.now(),
            url: instructionsUrl,
          } as CacheMetadata),
          "utf-8",
        );
        return await readFile(CACHE_FILE, "utf-8");
      }
      // Cache file missing but GitHub says not modified - fall through to re-fetch
    }

    // 200 OK - new content or first fetch
    if (response.ok) {
      const instructions = await response.text();
      const newETag = response.headers.get("etag");

      logger.info("Fetched new Codex instructions", {
        tag: latestTag,
        etag: newETag,
        size: instructions.length,
      });

      // Create cache directory if it doesn't exist
      await mkdir(CACHE_DIR, { recursive: true });

      // Cache the instructions with ETag and tag
      await writeFile(CACHE_FILE, instructions, "utf-8");
      await writeFile(
        CACHE_METADATA_FILE,
        JSON.stringify({
          etag: newETag,
          tag: latestTag,
          lastChecked: Date.now(),
          url: instructionsUrl,
        } as CacheMetadata),
        "utf-8",
      );

      return instructions;
    }

    throw new Error(
      `HTTP ${response.status} ${response.statusText} fetching instructions`,
    );
  } catch (error) {
    logger.error("Failed to fetch Codex instructions from GitHub", {
      error: String(error),
    });

    // Try to use cached version even if stale
    if (existsSync(CACHE_FILE)) {
      logger.warn("Using stale cached Codex instructions");
      return await readFile(CACHE_FILE, "utf-8");
    }

    // No cache available - this is a critical failure
    throw new Error(
      `Failed to fetch Codex instructions and no cache available: ${error}`,
    );
  }
}

/**
 * Preload Codex instructions at startup
 * This ensures instructions are cached before first request
 */
export async function preloadCodexInstructions(): Promise<void> {
  try {
    await getCodexInstructions();
    logger.info("Codex instructions preloaded successfully");
  } catch (error) {
    logger.error("Failed to preload Codex instructions", {
      error: String(error),
    });
    // Don't throw - allow app to start even if preload fails
  }
}
