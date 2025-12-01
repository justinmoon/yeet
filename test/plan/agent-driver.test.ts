import { describe, expect, test } from "bun:test";
import {
  AgentDriver,
  createCoderDriver,
  createReviewerDriver,
  createModelAuthConfig,
  formatTaggedOutput,
  formatPrefix,
  parsePrefix,
  formatInstructionsAsUserMessage,
  requiresUserMessageInjection,
  INSTRUCTIONS_PREFIX,
  buildCoderPrompt,
  buildReviewerPrompt,
  buildPrompt,
  buildContextSeed,
  type PromptConfig,
  type TaggedOutput,
  type ModelAuthConfig,
} from "../../src/plan";

const basePromptConfig: PromptConfig = {
  planPath: "docs/feature/plan.md",
  intentPath: "docs/feature/intent.md",
  specPath: "docs/feature/spec.md",
  activeStep: "1",
};

describe("AgentDriver", () => {
  describe("createCoderDriver", () => {
    test("creates driver with writable workspace", () => {
      const driver = createCoderDriver("/test/path", basePromptConfig);

      expect(driver.getRole()).toBe("coder");
      expect(driver.canWrite()).toBe(true);
    });

    test("workspace binding has correct properties", () => {
      const driver = createCoderDriver("/test/path", basePromptConfig);
      const binding = driver.getWorkspaceBinding();

      expect(binding.cwd).toBe("/test/path");
      expect(binding.allowWrites).toBe(true);
      expect(binding.isolationMode).toBe("shared");
    });
  });

  describe("createReviewerDriver", () => {
    test("creates driver with read-only workspace", () => {
      const driver = createReviewerDriver("/test/path", basePromptConfig);

      expect(driver.getRole()).toBe("reviewer");
      expect(driver.canWrite()).toBe(false);
    });

    test("workspace binding has read-only properties", () => {
      const driver = createReviewerDriver("/test/path", basePromptConfig);
      const binding = driver.getWorkspaceBinding();

      expect(binding.cwd).toBe("/test/path");
      expect(binding.allowWrites).toBe(false);
      expect(binding.isolationMode).toBe("sandbox");
      expect(binding.label).toContain("read-only");
    });
  });

  describe("coder context reset", () => {
    test("resetContext clears message history", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      driver.addMessage("user", "Message 1");
      driver.addMessage("assistant", "Response 1");
      expect(driver.getMessageHistory().length).toBe(2);

      driver.resetContext({ ...basePromptConfig, activeStep: "2" });

      expect(driver.getMessageHistory().length).toBe(0);
    });

    test("resetContext clears tool calls", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      driver.recordToolCall("bash", { command: "ls" });
      expect(driver.getToolCalls().length).toBe(1);

      driver.resetContext({ ...basePromptConfig, activeStep: "2" });

      expect(driver.getToolCalls().length).toBe(0);
    });

    test("resetContext updates prompt config", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      const newConfig = { ...basePromptConfig, activeStep: "step-5" };
      driver.resetContext(newConfig);

      expect(driver.getSystemPrompt()).toContain("step-5");
    });
  });

  describe("reviewer cumulative history", () => {
    test("updatePromptConfig preserves message history", () => {
      const driver = createReviewerDriver("/test", basePromptConfig);

      driver.addMessage("user", "Message 1");
      driver.addMessage("assistant", "Response 1");

      driver.updatePromptConfig({ ...basePromptConfig, activeStep: "2" });

      expect(driver.getMessageHistory().length).toBe(2);
    });

    test("history is trimmed when exceeding max", () => {
      const driver = createReviewerDriver("/test", basePromptConfig, 5);

      for (let i = 0; i < 10; i++) {
        driver.addMessage("user", `Message ${i}`);
      }

      const history = driver.getMessageHistory();
      expect(history.length).toBe(5);
      expect(history[0].content).toBe("Message 5"); // First 5 were trimmed
    });

    test("buildHistorySummary returns recent messages", () => {
      const driver = createReviewerDriver("/test", basePromptConfig);

      driver.addMessage("user", "First message");
      driver.addMessage("assistant", "First response");
      driver.addMessage("user", "Second message");

      const summary = driver.buildHistorySummary(2);

      expect(summary).toContain("First response");
      expect(summary).toContain("Second message");
    });
  });

  describe("system prompts", () => {
    test("coder prompt contains current step", () => {
      const config = { ...basePromptConfig, activeStep: "step-42" };
      const driver = createCoderDriver("/test", config);

      const prompt = driver.getSystemPrompt();

      expect(prompt).toContain("step-42");
      expect(prompt).toContain("Coder");
    });

    test("coder prompt contains intent/spec references", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      const prompt = driver.getSystemPrompt();

      expect(prompt).toContain("docs/feature/intent.md");
      expect(prompt).toContain("docs/feature/spec.md");
      expect(prompt).toContain("docs/feature/plan.md");
    });

    test("reviewer prompt contains current step", () => {
      const config = { ...basePromptConfig, activeStep: "step-7" };
      const driver = createReviewerDriver("/test", config);

      const prompt = driver.getSystemPrompt();

      expect(prompt).toContain("step-7");
      expect(prompt).toContain("Reviewer");
    });

    test("reviewer prompt mentions read-only mode", () => {
      const driver = createReviewerDriver("/test", basePromptConfig);

      const prompt = driver.getSystemPrompt();

      expect(prompt).toContain("read-only");
    });

    test("prompt includes step content when provided", () => {
      const config = {
        ...basePromptConfig,
        stepContent: "Implement the authentication flow",
      };
      const driver = createCoderDriver("/test", config);

      const prompt = driver.getSystemPrompt();

      expect(prompt).toContain("Implement the authentication flow");
    });

    test("prompt includes prior history when provided", () => {
      const config = {
        ...basePromptConfig,
        priorHistory: "Step 1 approved. Step 2 had one revision.",
      };
      const driver = createCoderDriver("/test", config);

      const prompt = driver.getSystemPrompt();

      expect(prompt).toContain("Step 1 approved");
      expect(prompt).toContain("Step 2 had one revision");
    });

    test("setPriorHistory updates prompt", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      driver.setPriorHistory("Previous step completed successfully");

      const prompt = driver.getSystemPrompt();
      expect(prompt).toContain("Previous step completed successfully");
    });
  });

  describe("context seed", () => {
    test("coder context seed mentions implementation", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      const seed = driver.getContextSeed();

      expect(seed).toContain("implement");
      expect(seed).toContain(basePromptConfig.activeStep);
    });

    test("reviewer context seed mentions review", () => {
      const driver = createReviewerDriver("/test", basePromptConfig);

      const seed = driver.getContextSeed();

      expect(seed).toContain("review");
      expect(seed).toContain(basePromptConfig.activeStep);
    });
  });

  describe("serialization", () => {
    test("serialize and deserialize preserves state", () => {
      const driver = createReviewerDriver("/test", basePromptConfig);

      driver.addMessage("user", "Test message");
      driver.recordToolCall("bash", { command: "ls" }, "file.txt");

      const serialized = driver.serialize();
      const restored = AgentDriver.deserialize(serialized);

      expect(restored.getRole()).toBe("reviewer");
      expect(restored.getMessageHistory().length).toBe(1);
      expect(restored.getToolCalls().length).toBe(1);
      expect(restored.canWrite()).toBe(false);
    });
  });
});

describe("Output Tagging", () => {
  describe("formatPrefix", () => {
    test("formats message prefix", () => {
      expect(formatPrefix("coder", "message")).toBe("[coder]");
      expect(formatPrefix("reviewer", "message")).toBe("[reviewer]");
    });

    test("formats tool call prefix", () => {
      expect(formatPrefix("coder", "tool_call", "bash")).toBe("[coder:bash]");
      expect(formatPrefix("reviewer", "tool_call", "read")).toBe("[reviewer:read]");
    });

    test("formats tool result prefix", () => {
      expect(formatPrefix("coder", "tool_result", "edit")).toBe("[coder:edit]");
    });

    test("uses 'tool' for missing tool name", () => {
      expect(formatPrefix("coder", "tool_call")).toBe("[coder:tool]");
    });
  });

  describe("formatTaggedOutput", () => {
    test("formats message output", () => {
      const output: TaggedOutput = {
        role: "coder",
        type: "message",
        content: "Starting implementation",
        timestamp: Date.now(),
      };

      expect(formatTaggedOutput(output)).toBe("[coder] Starting implementation");
    });

    test("formats tool call output", () => {
      const output: TaggedOutput = {
        role: "reviewer",
        type: "tool_call",
        toolName: "bash",
        content: "npm test",
        timestamp: Date.now(),
      };

      expect(formatTaggedOutput(output)).toBe("[reviewer:bash] npm test");
    });
  });

  describe("parsePrefix", () => {
    test("parses message prefix", () => {
      const result = parsePrefix("[coder]");

      expect(result).not.toBeNull();
      expect(result?.role).toBe("coder");
      expect(result?.toolName).toBeUndefined();
    });

    test("parses tool prefix", () => {
      const result = parsePrefix("[reviewer:bash]");

      expect(result).not.toBeNull();
      expect(result?.role).toBe("reviewer");
      expect(result?.toolName).toBe("bash");
    });

    test("returns null for invalid prefix", () => {
      expect(parsePrefix("coder")).toBeNull();
      expect(parsePrefix("[invalid]")).toBeNull();
      expect(parsePrefix("")).toBeNull();
    });
  });

  describe("AgentDriver tagging methods", () => {
    test("tagMessage creates correct output", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      const output = driver.tagMessage("Hello world");

      expect(output.role).toBe("coder");
      expect(output.type).toBe("message");
      expect(output.content).toBe("Hello world");
    });

    test("tagToolCall creates correct output", () => {
      const driver = createReviewerDriver("/test", basePromptConfig);

      const output = driver.tagToolCall("bash", "ls -la");

      expect(output.role).toBe("reviewer");
      expect(output.type).toBe("tool_call");
      expect(output.toolName).toBe("bash");
      expect(output.content).toBe("ls -la");
    });

    test("tagToolResult creates correct output", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      const output = driver.tagToolResult("edit", "File updated");

      expect(output.role).toBe("coder");
      expect(output.type).toBe("tool_result");
      expect(output.toolName).toBe("edit");
    });

    test("getPrefix returns correct prefix", () => {
      const coderDriver = createCoderDriver("/test", basePromptConfig);
      const reviewerDriver = createReviewerDriver("/test", basePromptConfig);

      expect(coderDriver.getPrefix()).toBe("[coder]");
      expect(coderDriver.getPrefix("bash")).toBe("[coder:bash]");
      expect(reviewerDriver.getPrefix()).toBe("[reviewer]");
      expect(reviewerDriver.getPrefix("read")).toBe("[reviewer:read]");
    });

    test("formatOutput formats correctly", () => {
      const driver = createCoderDriver("/test", basePromptConfig);
      const output = driver.tagToolCall("edit", "Updating file.ts");

      const formatted = driver.formatOutput(output);

      expect(formatted).toBe("[coder:edit] Updating file.ts");
    });
  });
});

describe("Prompt Builder", () => {
  describe("buildCoderPrompt", () => {
    test("includes role header", () => {
      const prompt = buildCoderPrompt(basePromptConfig);

      expect(prompt).toContain("# Role: Coder");
    });

    test("includes current step", () => {
      const config = { ...basePromptConfig, activeStep: "step-3" };
      const prompt = buildCoderPrompt(config);

      expect(prompt).toContain("step-3");
    });

    test("includes reference documents", () => {
      const prompt = buildCoderPrompt(basePromptConfig);

      expect(prompt).toContain("docs/feature/plan.md");
      expect(prompt).toContain("docs/feature/intent.md");
      expect(prompt).toContain("docs/feature/spec.md");
    });

    test("includes request_review instruction", () => {
      const prompt = buildCoderPrompt(basePromptConfig);

      expect(prompt).toContain("request_review");
    });
  });

  describe("buildReviewerPrompt", () => {
    test("includes role header", () => {
      const prompt = buildReviewerPrompt(basePromptConfig);

      expect(prompt).toContain("# Role: Reviewer");
    });

    test("includes review actions", () => {
      const prompt = buildReviewerPrompt(basePromptConfig);

      expect(prompt).toContain("approve");
      expect(prompt).toContain("request_changes");
      expect(prompt).toContain("ask_user");
    });

    test("emphasizes read-only mode", () => {
      const prompt = buildReviewerPrompt(basePromptConfig);

      expect(prompt).toContain("read-only");
      expect(prompt).toContain("cannot modify");
    });
  });

  describe("buildPrompt", () => {
    test("dispatches to coder prompt", () => {
      const prompt = buildPrompt("coder", basePromptConfig);

      expect(prompt).toContain("Coder");
    });

    test("dispatches to reviewer prompt", () => {
      const prompt = buildPrompt("reviewer", basePromptConfig);

      expect(prompt).toContain("Reviewer");
    });

    test("throws for unknown role", () => {
      expect(() => buildPrompt("unknown" as any, basePromptConfig)).toThrow();
    });
  });

  describe("buildContextSeed", () => {
    test("coder seed focuses on implementation", () => {
      const seed = buildContextSeed("coder", basePromptConfig);

      expect(seed.toLowerCase()).toContain("implement");
    });

    test("reviewer seed focuses on review", () => {
      const seed = buildContextSeed("reviewer", basePromptConfig);

      expect(seed.toLowerCase()).toContain("review");
    });

    test("includes step in seed", () => {
      const config = { ...basePromptConfig, activeStep: "step-42" };

      expect(buildContextSeed("coder", config)).toContain("step-42");
      expect(buildContextSeed("reviewer", config)).toContain("step-42");
    });
  });
});

describe("Model Auth Config", () => {
  describe("createModelAuthConfig", () => {
    test("detects Codex models", () => {
      const config = createModelAuthConfig("gpt-5-codex", "oauth");
      expect(config.isCodex).toBe(true);
    });

    test("detects GPT-5 as Codex", () => {
      const config = createModelAuthConfig("gpt-5", "oauth");
      expect(config.isCodex).toBe(true);
    });

    test("non-Codex models are detected", () => {
      const config = createModelAuthConfig("claude-3-opus", "anthropic");
      expect(config.isCodex).toBe(false);
    });

    test("gpt-4o is not Codex", () => {
      const config = createModelAuthConfig("gpt-4o", "api-key");
      expect(config.isCodex).toBe(false);
    });
  });

  describe("requiresUserMessageInjection", () => {
    test("Codex with OAuth requires injection", () => {
      const config: ModelAuthConfig = {
        model: "gpt-5-codex",
        authType: "oauth",
        isCodex: true,
      };
      expect(requiresUserMessageInjection(config)).toBe(true);
    });

    test("Codex with API key does not require injection", () => {
      const config: ModelAuthConfig = {
        model: "gpt-5-codex",
        authType: "api-key",
        isCodex: true,
      };
      expect(requiresUserMessageInjection(config)).toBe(false);
    });

    test("Claude does not require injection", () => {
      const config: ModelAuthConfig = {
        model: "claude-3-opus",
        authType: "anthropic",
        isCodex: false,
      };
      expect(requiresUserMessageInjection(config)).toBe(false);
    });

    test("non-Codex with OAuth does not require injection", () => {
      const config: ModelAuthConfig = {
        model: "gpt-4o",
        authType: "oauth",
        isCodex: false,
      };
      expect(requiresUserMessageInjection(config)).toBe(false);
    });
  });

  describe("formatInstructionsAsUserMessage", () => {
    test("formats instructions like AGENTS.md", () => {
      const result = formatInstructionsAsUserMessage("coder", "You are a coder.");

      expect(result).toContain(INSTRUCTIONS_PREFIX);
      expect(result).toContain("coder");
      expect(result).toContain("<INSTRUCTIONS>");
      expect(result).toContain("You are a coder.");
      expect(result).toContain("</INSTRUCTIONS>");
    });

    test("includes role in prefix", () => {
      const coderResult = formatInstructionsAsUserMessage("coder", "test");
      const reviewerResult = formatInstructionsAsUserMessage("reviewer", "test");

      expect(coderResult).toContain("# Agent instructions for coder");
      expect(reviewerResult).toContain("# Agent instructions for reviewer");
    });
  });
});

describe("AgentDriver with ModelAuth", () => {
  describe("Codex OAuth mode", () => {
    const codexOAuth: ModelAuthConfig = {
      model: "gpt-5-codex",
      authType: "oauth",
      isCodex: true,
    };

    test("requiresUserMessageInjection returns true", () => {
      const driver = createCoderDriver("/test", basePromptConfig, codexOAuth);
      expect(driver.requiresUserMessageInjection()).toBe(true);
    });

    test("getSystemPrompt returns null", () => {
      const driver = createCoderDriver("/test", basePromptConfig, codexOAuth);
      expect(driver.getSystemPrompt()).toBe(null);
    });

    test("getInstructionsAsUserMessage returns formatted message", () => {
      const driver = createCoderDriver("/test", basePromptConfig, codexOAuth);
      const msg = driver.getInstructionsAsUserMessage();

      expect(msg).toContain(INSTRUCTIONS_PREFIX);
      expect(msg).toContain("<INSTRUCTIONS>");
      expect(msg).toContain("Coder");
    });
  });

  describe("API key mode", () => {
    const apiKeyAuth: ModelAuthConfig = {
      model: "gpt-5-codex",
      authType: "api-key",
      isCodex: true,
    };

    test("requiresUserMessageInjection returns false", () => {
      const driver = createCoderDriver("/test", basePromptConfig, apiKeyAuth);
      expect(driver.requiresUserMessageInjection()).toBe(false);
    });

    test("getSystemPrompt returns prompt string", () => {
      const driver = createCoderDriver("/test", basePromptConfig, apiKeyAuth);
      const prompt = driver.getSystemPrompt();

      expect(prompt).not.toBe(null);
      expect(prompt).toContain("Coder");
    });
  });

  describe("Claude mode", () => {
    const claudeAuth: ModelAuthConfig = {
      model: "claude-3-opus",
      authType: "anthropic",
      isCodex: false,
    };

    test("requiresUserMessageInjection returns false", () => {
      const driver = createReviewerDriver("/test", basePromptConfig, 50, claudeAuth);
      expect(driver.requiresUserMessageInjection()).toBe(false);
    });

    test("getSystemPrompt returns prompt string", () => {
      const driver = createReviewerDriver("/test", basePromptConfig, 50, claudeAuth);
      const prompt = driver.getSystemPrompt();

      expect(prompt).not.toBe(null);
      expect(prompt).toContain("Reviewer");
    });
  });

  describe("no modelAuth (default)", () => {
    test("requiresUserMessageInjection returns false", () => {
      const driver = createCoderDriver("/test", basePromptConfig);
      expect(driver.requiresUserMessageInjection()).toBe(false);
    });

    test("getSystemPrompt returns prompt string", () => {
      const driver = createCoderDriver("/test", basePromptConfig);
      expect(driver.getSystemPrompt()).not.toBe(null);
    });
  });

  describe("setModelAuth", () => {
    test("can switch modes at runtime", () => {
      const driver = createCoderDriver("/test", basePromptConfig);

      // Initially no injection required
      expect(driver.requiresUserMessageInjection()).toBe(false);

      // Switch to Codex OAuth
      driver.setModelAuth({
        model: "gpt-5-codex",
        authType: "oauth",
        isCodex: true,
      });

      // Now injection is required
      expect(driver.requiresUserMessageInjection()).toBe(true);
      expect(driver.getSystemPrompt()).toBe(null);
    });
  });

  describe("serialization with modelAuth", () => {
    test("preserves modelAuth through serialize/deserialize", () => {
      const codexOAuth: ModelAuthConfig = {
        model: "gpt-5-codex",
        authType: "oauth",
        isCodex: true,
      };

      const driver = createCoderDriver("/test", basePromptConfig, codexOAuth);
      const serialized = driver.serialize();
      const restored = AgentDriver.deserialize(serialized);

      expect(restored.requiresUserMessageInjection()).toBe(true);
      expect(restored.getModelAuth()).toEqual(codexOAuth);
    });
  });
});
