/**
 * Filesystem snapshot using git tree objects
 * Stores filesystem state as git tree hashes without creating commits
 */

import fs from "node:fs";
import path from "node:path";
import git from "isomorphic-git";

export interface SnapshotMetadata {
  treeHash: string;
  timestamp: number;
  description?: string;
}

export class FilesystemSnapshot {
  constructor(
    private dir: string,
    private gitdir: string = path.join(dir, ".git"),
  ) {}

  /**
   * Capture current filesystem state as a git tree
   * Returns the tree hash (immutable identifier)
   */
  async capture(description?: string): Promise<SnapshotMetadata> {
    // Get current HEAD tree hash as the snapshot
    // This works because agents modify the working directory
    // and we can get the tree from the current commit
    const headRef = await git.resolveRef({
      fs,
      dir: this.dir,
      gitdir: this.gitdir,
      ref: "HEAD",
    });

    const { object: commit } = await git.readObject({
      fs,
      dir: this.dir,
      gitdir: this.gitdir,
      oid: headRef,
    });

    // @ts-ignore - commit has tree property
    const treeHash = commit.tree;

    return {
      treeHash,
      timestamp: Date.now(),
      description,
    };
  }

  /**
   * Restore filesystem to a snapshot
   */
  async restore(snapshot: string | SnapshotMetadata): Promise<void> {
    const treeHash =
      typeof snapshot === "string" ? snapshot : snapshot.treeHash;

    // Checkout the tree without creating a commit
    await git.checkout({
      fs,
      dir: this.dir,
      gitdir: this.gitdir,
      ref: treeHash,
      force: true,
    });
  }

  /**
   * Get diff between two snapshots
   */
  async diff(
    fromSnapshot: string | SnapshotMetadata,
    toSnapshot: string | SnapshotMetadata,
  ): Promise<{ path: string; type: "added" | "modified" | "deleted" }[]> {
    const fromHash =
      typeof fromSnapshot === "string" ? fromSnapshot : fromSnapshot.treeHash;
    const toHash =
      typeof toSnapshot === "string" ? toSnapshot : toSnapshot.treeHash;

    const changes: { path: string; type: "added" | "modified" | "deleted" }[] =
      [];

    // Walk both trees and compare
    await git.walk({
      fs,
      dir: this.dir,
      gitdir: this.gitdir,
      trees: [git.TREE({ ref: fromHash }), git.TREE({ ref: toHash })],
      map: async (filepath, [beforeEntry, afterEntry]) => {
        if (!beforeEntry && afterEntry) {
          changes.push({ path: filepath, type: "added" });
        } else if (beforeEntry && !afterEntry) {
          changes.push({ path: filepath, type: "deleted" });
        } else if (beforeEntry && afterEntry) {
          const beforeOid = await beforeEntry.oid();
          const afterOid = await afterEntry.oid();
          if (beforeOid !== afterOid) {
            changes.push({ path: filepath, type: "modified" });
          }
        }
        return null;
      },
    });

    return changes;
  }

  /**
   * Read file content from a snapshot
   */
  async readFile(
    snapshot: string | SnapshotMetadata,
    filepath: string,
  ): Promise<string> {
    const treeHash =
      typeof snapshot === "string" ? snapshot : snapshot.treeHash;

    const { blob } = await git.readBlob({
      fs,
      dir: this.dir,
      gitdir: this.gitdir,
      oid: treeHash,
      filepath,
    });

    return new TextDecoder().decode(blob);
  }
}
