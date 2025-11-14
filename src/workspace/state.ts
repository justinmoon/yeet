import {
  assertWorkspaceWriteAllowed,
  createDefaultWorkspaceBinding,
  type WorkspaceBinding,
} from "./binding";

let activeWorkspaceBinding: WorkspaceBinding = createDefaultWorkspaceBinding(
  process.cwd(),
);

export function setActiveWorkspaceBinding(
  binding: WorkspaceBinding,
): void {
  activeWorkspaceBinding = binding;
}

export function getActiveWorkspaceBinding(): WorkspaceBinding {
  return activeWorkspaceBinding;
}

export function ensureWorkspaceWriteAccess(action: string): void {
  assertWorkspaceWriteAllowed(activeWorkspaceBinding, action);
}
