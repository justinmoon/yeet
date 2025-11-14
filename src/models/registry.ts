export interface ModelInfo {
  id: string;
  provider: "opencode" | "maple" | "anthropic" | "openai";
  name: string;
  pricing: string;
  contextWindow: number; // Maximum tokens in context window
}

export const MODELS: ModelInfo[] = [
  // Anthropic models
  {
    id: "claude-sonnet-4-5-20250929",
    provider: "anthropic",
    name: "Claude Sonnet 4.5",
    pricing: "$3/$15",
    contextWindow: 200000,
  },
  {
    id: "claude-opus-4-20250514",
    provider: "anthropic",
    name: "Claude Opus 4",
    pricing: "$15/$75",
    contextWindow: 200000,
  },
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    name: "Claude 3.5 Sonnet",
    pricing: "$3/$15",
    contextWindow: 200000,
  },
  {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    name: "Claude 3.5 Haiku",
    pricing: "$1/$5",
    contextWindow: 200000,
  },
  {
    id: "claude-3-opus-20240229",
    provider: "anthropic",
    name: "Claude 3 Opus",
    pricing: "$15/$75",
    contextWindow: 200000,
  },
  {
    id: "claude-3-sonnet-20240229",
    provider: "anthropic",
    name: "Claude 3 Sonnet",
    pricing: "$3/$15",
    contextWindow: 200000,
  },
  {
    id: "claude-3-haiku-20240307",
    provider: "anthropic",
    name: "Claude 3 Haiku",
    pricing: "$0.25/$1.25",
    contextWindow: 200000,
  },
  // OpenCode models
  {
    id: "grok-code",
    provider: "opencode",
    name: "Grok Code",
    pricing: "FREE",
    contextWindow: 128000,
  },
  {
    id: "claude-sonnet-4-5",
    provider: "opencode",
    name: "Claude Sonnet 4.5",
    pricing: "$3/$15",
    contextWindow: 200000,
  },
  {
    id: "claude-haiku-4-5",
    provider: "opencode",
    name: "Claude Haiku 4.5",
    pricing: "$1/$5",
    contextWindow: 200000,
  },
  {
    id: "claude-3-5-haiku",
    provider: "opencode",
    name: "Claude 3.5 Haiku",
    pricing: "$1/$5",
    contextWindow: 200000,
  },
  {
    id: "claude-sonnet-4",
    provider: "opencode",
    name: "Claude Sonnet 4",
    pricing: "$3/$15",
    contextWindow: 200000,
  },
  {
    id: "qwen3-coder",
    provider: "opencode",
    name: "Qwen3 Coder",
    pricing: "$0.45/$1.50",
    contextWindow: 128000,
  },
  {
    id: "kimi-k2",
    provider: "opencode",
    name: "Kimi K2",
    pricing: "$0.60/$2.50",
    contextWindow: 128000,
  },
  {
    id: "mistral-small-3-1-24b",
    provider: "maple",
    name: "Mistral Small",
    pricing: "$0.15/$0.60",
    contextWindow: 32000,
  },
  {
    id: "mistral-medium",
    provider: "maple",
    name: "Mistral Medium",
    pricing: "$2.70/$8.10",
    contextWindow: 32000,
  },
  {
    id: "mistral-large",
    provider: "maple",
    name: "Mistral Large",
    pricing: "$3/$9",
    contextWindow: 128000,
  },
  // OpenAI models (ChatGPT Pro/Codex)
  {
    id: "gpt-5",
    provider: "openai",
    name: "GPT-5",
    pricing: "ChatGPT Pro",
    contextWindow: 128000,
  },
  {
    id: "gpt-5-codex",
    provider: "openai",
    name: "GPT-5 Codex",
    pricing: "ChatGPT Pro",
    contextWindow: 128000,
  },
];

export function getModelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelsByProvider(
  provider: "opencode" | "maple" | "anthropic" | "openai",
): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}
