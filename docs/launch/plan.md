# Launch Plan

## Phase 1: MVP (`yeet launch` without sandbox)

1. **Add `homeConfigurations.agent` output**
   - Update `~/configs/flake.nix` to expose `home-manager.lib.homeManagerConfiguration` targeting username `agent`, home `/home/agent`, profile `remote`.
   - Acceptance: `nix build ~/configs#homeConfigurations.agent.activationPackage` succeeds.

2. **Implement CLI subcommand**
   - Add `yeet launch` entry (CLI + command palette) that accepts repo URL/path, optional devShell name, `--rev`, `-p`/`-e`, `--session`.
   - Acceptance: running `bun run src/index.ts launch --repo ~/code/yeet` clones into `~/.local/share/yeet/sessions/<session>` and starts Yeet in that workspace.

3. **Session metadata & persistence**
   - Store JSON per session (`state.json` with repo, rev, prompt path, status) under the session directory; persist PTY/log references so the TUI can resume.
   - Acceptance: `yeet launch` followed by `yeet launch --list` (or command palette “Switch session”) shows the active session.

4. **Command palette integration**
   - Add entries for “Launch new agent” (prompts interactively for repo/prompt) and “Switch session”.
   - Acceptance: Using the palette reproduces the CLI behaviors without leaving the TUI.

## Phase 2: Local sandbox backend (bubblewrap/landrun)

5. **Sandbox flag & backend abstraction**
   - Refactor launcher to support `--backend local` (default) and `--backend sandbox`. Define a backend interface so future Fly support plugs in later.
   - Acceptance: `yeet launch --backend local` behaves like Phase 1; flag is validated.

6. **Integrate sandbox wrapper**
   - For `--backend sandbox`, invoke bubblewrap/landrun with the policy from spec (nix store ro, `/workspace`, `/home/agent` populated via `homeConfigurations.agent` activation).
   - Acceptance: launching with sandbox creates `/home/agent` populated by Home Manager and Yeet runs inside the namespace (verify via `env | grep HOME`).

7. **Session status & teardown**
   - Track sandbox-specific metadata (process IDs, namespaces) to support stop/cleanup commands.
   - Acceptance: `yeet launch --backend sandbox --session foo`; later `yeet sessions --stop foo` terminates it cleanly.

## Phase 3: Remote backend (Fly/Hetzner VPS)

8. **NixOS image build**
   - Create a flake target that builds a minimal NixOS/Fly image with Yeet + `homeConfigurations.agent` baked in.
   - Acceptance: `nix build ~/configs#nixosConfigurations.agent-vm.config.system.build?.` (or Fly machine image) succeeds and boots locally.

9. **Fly backend integration**
   - Implement `--backend fly`, provisioning a machine from the image, injecting session metadata/prompt, and establishing an exec channel for Yeet.
   - Acceptance: `yeet launch --backend fly --repo ...` starts a remote session accessible through the TUI; metadata records instance ID.

10. **Unified session management UI**
    - Extend the TUI to display local/sandbox/remote sessions with status, allow switching, attach/detach, and terminate remote instances.
    - Acceptance: switching between an existing local session and a Fly-backed session works without leaving Yeet; UI indicates backend type.

Each phase builds on previous steps, letting us ship a usable non-sandboxed MVP quickly, then layer local isolation and remote execution backends.
