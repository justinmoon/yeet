# Launch Specs

## 1. MVP (No Sandbox)

Goal: add a `yeet launch` flow that spins up a new agent session using any git repo whose flake exports a devShell. This version focuses purely on workflow UX; no filesystem or network isolation yet.

### Requirements
- `yeet launch` CLI subcommand plus equivalent command-palette entry (Linux only for now).
- Input args: primary repo URL or path (must contain `flake.nix` + devShell), optional `--session-name`, `-p prompt text`, `-e` to open `$EDITOR` for prompt, optional `--rev` (default main).
- Launcher flow:
  1. Create per-session directory under `~/.local/share/yeet/sessions/<name>`.
  2. Clone/fetch repo into `workspace/repo` and checkout `rev`; if multiple repos are provided, clone each into its own subdir using idiomatic nix approach (TBD, but keep it simple).
  3. If prompt provided, write to `workspace/prompt.txt`.
  4. Run `nix develop <repo>#<devShell or default> --command yeet --prompt-file workspace/prompt.txt` (need to define how Yeet consumes the prompt file; for MVP you can just display path and let user paste).
- Session metadata: store minimal JSON alongside workspace describing repo, rev, prompt, timestamp; Yeet TUI can list sessions via this data and attach/detach from their PTYs.
- UX: from TUI, command palette entry “Launch new agent” prompts for repo URL + prompt and spawns the CLI; “Switch session” lists active sessions and attaches (no multiplexing yet).

### Nice-to-haves
- Auto-detect devShell name if multiple exist; default to `devShells.default` but allow `--devshell <name>`.
- Optional `--cmd` override to run something other than `yeet` (hidden for MVP).
- Basic logging under `~/.local/share/yeet/sessions/<name>/launch.log`.

## 2. Local Sandbox (bubblewrap/landrun on justin@hetzner)

Goal: extend the launcher to run each session inside bubblewrap while still consuming the same CLI UX from MVP.

### Requirements
- New launcher flag `--sandbox bubblewrap` (default off initially). When enabled:
  1. Prepare session workspace just like MVP.
  2. Before entering bwrap, build/apply the Home Manager configuration exported by `~/configs/flake.nix` (add a `homeConfigurations.agent` output that imports `./home { profile = "remote"; }` and sets `home.username = "agent"`/`home.homeDirectory = "/home/agent"`). Inside the sandbox, run the activation package so `/home/agent` gets populated by Home Manager instead of ad-hoc bind mounts.
  3. Run `nix develop ... --command bwrap ... yeet` (or invoke an off-the-shelf wrapper such as `landrun-nix`/`nixpak` that emits the equivalent sandbox) where the sandbox:
     - Bind-mounts the nix store read-only, `/etc/resolv.conf`, and the session workspace as `/workspace`.
     - Mounts a tmpfs at `/home/agent`, then executes the activation script from step 2 to install configs (fish, helix, `~/.config/yeet`, etc.) exactly as defined in `~/configs/home`.
     - (Optional) unshare the network namespace in later iterations.
  4. Set env vars (`HOME=/home/agent`, `WORKSPACE=/workspace`, `PROMPT_FILE=/workspace/prompt.txt`).
- Yeet TUI should surface sandboxed sessions distinctly (icon or label) and expose minimal status (running/exited) by reading metadata.
- CLI should detect missing `bubblewrap` and fall back or error gracefully.

### Future hooks
- Support additional mount specs via CLI or config for extra repos/credentials on launch.
- Start wiring interactive prompts (“agent requests access to repo X?”) for mid-session mounts.

## 3. Remote VPS backend (e.g., Hetzner Cloud/Fly)

Goal: allow `yeet launch --backend fly` (or similar) to provision dedicated VPS instances per session.

### Requirements
- Abstract launcher backends: `local` (default), `bubblewrap`, `fly`.
- For Fly backend:
  1. Build/publish a minimal NixOS image (from your configs flake) containing Yeet + dependencies (reuse the same Home Manager module as above so configs stay declarative).
  2. `yeet launch` uses Fly API to clone that machine, inject session metadata/prompt (via env or startup script), and expose an SSH/`fly machine exec` channel.
  3. Yeet attaches via that channel; streaming output pipes back into the TUI.
  4. Metadata tracks instance IDs so sessions can be terminated from the TUI.
- Similar pattern for Hetzner Cloud if desired.

### Considerations
- Secrets: rely on your `~/configs/home` flake to provision `~/.config/yeet` inside the VM; confirm keys are stored securely (sops) before production.
- Cost control: auto-stop or prompt before keeping idle remote sessions alive.

These specs build progressively: start with the MVP (no sandbox) to prove the UX, layer bubblewrap for local isolation, then add remote backends once the orchestration/control-plane pieces are solid.
