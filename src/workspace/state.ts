import {
  type WorkspaceBinding,
  assertWorkspaceWriteAllowed,
  createDefaultWorkspaceBinding,
} from "./binding";

const bindingStack: WorkspaceBinding[] = [
  createDefaultWorkspaceBinding(process.cwd()),
];

export function setActiveWorkspaceBinding(binding: WorkspaceBinding): void {
  bindingStack.length = 1;
  bindingStack[0] = binding;
}

export function pushWorkspaceBinding(binding: WorkspaceBinding): void {
  bindingStack.push(binding);
}

export function popWorkspaceBinding(): void {
  if (bindingStack.length > 1) {
    bindingStack.pop();
  }
}

export function getActiveWorkspaceBinding(): WorkspaceBinding {
  return bindingStack[bindingStack.length - 1];
}

export function ensureWorkspaceWriteAccess(action: string): void {
  assertWorkspaceWriteAllowed(getActiveWorkspaceBinding(), action);
}
