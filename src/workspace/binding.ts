import path from "path";
import type { WorkspacePolicy } from "../config";

export type WorkspaceIsolationMode = "shared" | "sandbox" | "custom";

export interface WorkspaceBinding {
  id: string;
  cwd: string;
  isolationMode: WorkspaceIsolationMode;
  allowWrites: boolean;
  label?: string;
}

export interface WorkspaceBindingOptions {
  basePath: string;
  policy?: WorkspacePolicy;
  label?: string;
  defaultAllowWrites?: boolean;
}

export function getLaunchCwd(): string {
  return process.env.YEET_ORIGINAL_PWD || process.cwd();
}

export function createDefaultWorkspaceBinding(cwd: string): WorkspaceBinding {
  return {
    id: `ws:${cwd}`,
    cwd,
    isolationMode: "shared",
    allowWrites: true,
  };
}

export function resolveWorkspaceBinding(
  options: WorkspaceBindingOptions,
): WorkspaceBinding {
  const { basePath, policy, label, defaultAllowWrites } = options;

  const isolationMode: WorkspaceIsolationMode =
    policy?.mode === "sandbox"
      ? "sandbox"
      : policy?.mode === "custom"
        ? "custom"
        : "shared";

  const cwd =
    policy?.mode === "custom" && policy.customPath
      ? path.resolve(policy.customPath)
      : basePath;

  let allowWrites: boolean;
  if (typeof policy?.allowWrites === "boolean") {
    allowWrites = policy.allowWrites;
  } else if (typeof defaultAllowWrites === "boolean") {
    allowWrites = defaultAllowWrites;
  } else if (isolationMode === "sandbox") {
    allowWrites = false;
  } else {
    allowWrites = true;
  }

  return {
    id: `ws:${cwd}`,
    cwd,
    isolationMode,
    allowWrites,
    label,
  };
}

export function assertWorkspaceWriteAllowed(
  binding: WorkspaceBinding,
  actionDescription: string,
): void {
  if (binding.allowWrites) return;

  const target = binding.label || binding.cwd;
  throw new Error(
    `Workspace "${target}" is read-only. Cannot perform ${actionDescription}.`,
  );
}
