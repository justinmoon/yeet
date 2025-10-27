export interface ModelInfo {
  id: string;
  provider: "opencode" | "maple";
  name: string;
  pricing: string;
}

export const MODELS: ModelInfo[] = [
  { id: "grok-code", provider: "opencode", name: "Grok Code", pricing: "FREE" },
  {
    id: "claude-sonnet-4-5",
    provider: "opencode",
    name: "Claude Sonnet 4.5",
    pricing: "$3/$15",
  },
  {
    id: "claude-haiku-4-5",
    provider: "opencode",
    name: "Claude Haiku 4.5",
    pricing: "$1/$5",
  },
  {
    id: "claude-3-5-haiku",
    provider: "opencode",
    name: "Claude 3.5 Haiku",
    pricing: "$1/$5",
  },
  {
    id: "claude-sonnet-4",
    provider: "opencode",
    name: "Claude Sonnet 4",
    pricing: "$3/$15",
  },
  {
    id: "qwen3-coder",
    provider: "opencode",
    name: "Qwen3 Coder",
    pricing: "$0.45/$1.50",
  },
  {
    id: "kimi-k2",
    provider: "opencode",
    name: "Kimi K2",
    pricing: "$0.60/$2.50",
  },
  {
    id: "mistral-small-3-1-24b",
    provider: "maple",
    name: "Mistral Small",
    pricing: "$0.15/$0.60",
  },
  {
    id: "mistral-medium",
    provider: "maple",
    name: "Mistral Medium",
    pricing: "$2.70/$8.10",
  },
  {
    id: "mistral-large",
    provider: "maple",
    name: "Mistral Large",
    pricing: "$3/$9",
  },
];

export function getModelInfo(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelsByProvider(
  provider: "opencode" | "maple",
): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}
