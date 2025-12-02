# Launch Intent

I want a generic launcher that can spin up fully isolated coding agents from any project that exposes a Nix flake devShell. The launcher should prepare a per-session workspace (clone/fetch repo, checkout rev), drop my full CLI environment into a bubblewrap namespace (fish, helix, `~/.config/yeet`, etc.), and then run Yeet inside that sandbox so the agent feels identical to my main shell but can’t touch other sessions. Over time Yeet’s TUI should grow first-class controls for launching new agents, viewing running sessions, and toggling between them, while the launcher becomes the backend that also supports alternative targets like Fly machines or other VPS instances.

My configs should be defined by one flake.nix (currently they are in ~/configs/home but we may need to tweak the flake somehow ... don't know if they are currently exposed in the propery way). 

## Clarifying Questions

1. Should the launcher always clone a repo into its own workspace, or can it reuse an existing directory when I pass one explicitly?

not a strong opinion but re-cloning makes sense to me. i don't really care how the code gets there but it should be isolated and deterministic.

2. How do I want to capture prompts long term—simple `-p` flags, `$EDITOR` flow, or richer templates tied to session types?

i want a `-p "prompt goes here"` or `-e` which opens `$EDITOR`

3. What level of network isolation does the first version actually need (shared host network vs. slirp4netns vs. full unshare with firewall rules)?

whatever is easiest to build. we will iterate on this. i just want a usable mvp. if it has no network isolation at all that's fine at this point.

4. Should the launcher be written as a portable shell script, a compiled binary, or even a flake app so it can be `nix run`-ed anywhere?

i think it should be a `yeet launch` subcommand initially, and then built into the yeet tui. i want yeet to be the only ui i use for vibecoding eventually.

5. Where do session metadata and logs live so that Yeet’s TUI can enumerate and reattach (e.g., `$XDG_STATE_HOME/yeet-launcher`)?

i don't care.

6. Do I want the launcher to manage lifecycle hooks (pre/post cleanup, uploading artifacts) or just leave the workspace on disk until I delete it?

just leave it for now.

7. How will Yeet detect and present remote backends like Fly machines—through the same metadata API or a separate discovery mechanism?

don't care. keep it simple.

8. Should the bubblewrap namespace mount my `~/configs/home` read-only or copy files into tmpfs to avoid accidental edits to shared config?

don't care

9. What happens when an agent needs additional repos or credentials mid-session—does the launcher permit mounting extra paths, or should Yeet request them interactively?

probably request interactively. i think we should be able to launch with multiple repos. of clone more during a session. changes often require multiple repos.

i think ideally nix config would have all the encrypted keys and stuff we need and we'd have a secure way of transmitting them to the agent with user approval for each one? or something like that.

10. How opinionated should the launcher be about the command it runs (always `yeet`, or allow arbitrary binaries so other agent frontends can reuse the same isolation flow)?

for now let's have it run `yeet` always

11. When you say “configs defined by one flake,” do you envision the launcher always referencing that flake directly (e.g., `launch-agent ~/configs/home#devShell`), or should it read defaults from Yeet’s config and let you override per session?

let's just operate on git repo urls and require that they have a flake with a dev shell; fail otherwise.

12. For multi-repo sessions, should the launcher accept a structured manifest (repo URL + target path + optional rev) or just take repeated `--repo PATH` arguments and leave checkout logic to you?

do the most idiomatic nix thing that's still simple

13. How do you want to handle long-running sessions after a reboot—should the launcher auto-recreate bubblewrap environments, or would you rather manually restart each session via Yeet?

let's ignore these scenarios for now to keep it simple.

14. Do you expect agents to need GUI/browser access (e.g., Playwright, Electron) inside the sandbox, and if so should the launcher wire in Wayland/X11 sockets by default?

eventually yes, but let's ignore for the mvp.

15. Should Yeet’s TUI display resource usage (CPU/RAM) per session, and if yes where should the launcher collect/report those metrics from?

good idea but let's ignore for the mvp.
