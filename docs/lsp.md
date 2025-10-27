   Yes, opencode does supply LSP diagnostics as context automatically, but it's NOT a tool call the agent must exercise. Here's how it works:

   Control Flow

   1. Automatic LSP Client Initialization (lazy):
     •  LSP clients are spawned on-demand when files are first accessed
     •  Defined in /src/lsp/index.ts and /src/lsp/server.ts
     •  Support for TypeScript, Python, Go, Rust, etc.

   2. Automatic Diagnostic Injection (after file modifications):
     •  When Write or Edit tools execute, they call:
        ```typescript
        await LSP.touchFile(filepath, true)  // Triggers LSP analysis
        const diagnostics = await LSP.diagnostics()  // Fetches all diagnostics
        ```
   •  Diagnostics are appended directly to the tool output, not sent as a separate message
   •  Uses special XML tags like <file_diagnostics> and <project_diagnostics>

   3. It's tacked onto existing tool results:
     •  From tool/write.ts:
        ```typescript
        let output = ""
        await LSP.touchFile(filepath, true)
        const diagnostics = await LSP.diagnostics()
        for (const [file, issues] of Object.entries(diagnostics)) {
          if (file === filepath) {
            output += \nThis file has errors, please fix\n<file_diagnostics>\n${issues.map(LSP.Diagnostic.pretty).join("\n")}\n</file_diagnostics>\n
          }
          // ... project-wide diagnostics too
        }
        return { output, ... }
        ```

   So it's neither a tool call nor a system reminder per se - it's automatically appended context within the tool result itself, happening transparently after any file
   modification.

