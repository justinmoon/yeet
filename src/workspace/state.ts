import {
  type WorkspaceBinding,
  assertWorkspaceWriteAllowed,
  createDefaultWorkspaceBinding,
  getLaunchCwd,
} from "./binding";

let bindingStack: WorkspaceBinding[] | null = null;

function getBindingStack(): WorkspaceBinding[] {
  if (!bindingStack) {
    bindingStack = [createDefaultWorkspaceBinding(getLaunchCwd())];
  }
  return bindingStack;
}

export function setActiveWorkspaceBinding(binding: WorkspaceBinding): void {
  const stack = getBindingStack();
  stack.length = 1;
  stack[0] = binding;
}

export function pushWorkspaceBinding(binding: WorkspaceBinding): void {
  getBindingStack().push(binding);
}

export function popWorkspaceBinding(): void {
  const stack = getBindingStack();
  if (stack.length > 1) {
    stack.pop();
  }
}

export function getActiveWorkspaceBinding(): WorkspaceBinding {
  const stack = getBindingStack();
  return stack[stack.length - 1];
}

export function ensureWorkspaceWriteAccess(action: string): void {
  assertWorkspaceWriteAllowed(getActiveWorkspaceBinding(), action);
}

/**
 * Resolve a path relative to the active workspace cwd.
 * If the path is already absolute, returns it unchanged.
 */
export function resolveWorkspacePath(path: string): string {
  const { isAbsolute, join } = require("node:path");
  if (isAbsolute(path)) {
    return path;
  }
  const binding = getActiveWorkspaceBinding();
  return join(binding.cwd, path);
}
