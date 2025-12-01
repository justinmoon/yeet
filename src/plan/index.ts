/**
 * Plan state management for coder/reviewer orchestration.
 *
 * This module handles parsing, loading, saving, and validating plan.md files
 * that drive the coder/reviewer workflow.
 */

// Types
export type {
  PlanFrontmatter,
  ParsedPlan,
  ValidationResult,
  ValidationError,
} from "./types";
export { DEFAULT_ACTIVE_STEP } from "./types";

// Parser
export { parsePlan, serializePlan, ParseError } from "./parser";

// Loader
export {
  loadPlan,
  savePlan,
  updatePlanFrontmatter,
  createPlan,
  LoadError,
} from "./loader";

// Validation
export {
  validatePlanContent,
  validateSpecContent,
  formatValidationMessage,
  PlanFrontmatterSchema,
} from "./validation";

// Hooks
export type { ValidationHookResult } from "./hook";
export {
  validateOnWrite,
  shouldValidate,
  createWriteInterceptor,
} from "./hook";

// Flow state machine
export type {
  FlowState,
  FlowEvent,
  FlowContext,
  FlowHooks,
  FlowConfig,
  TransitionRecord,
  AgentRole,
} from "./flow-types";
export { DEFAULT_FLOW_CONFIG } from "./flow-types";
export { FlowMachine, type TransitionResult } from "./flow-machine";

// Agent driver types
export type {
  AgentMessage,
  PromptConfig,
  AgentWorkspaceConfig,
  AgentDriverConfig,
  AgentToolCall,
  TaggedOutput,
  ModelAuthConfig,
} from "./agent-driver-types";
export {
  formatTaggedOutput,
  formatPrefix,
  parsePrefix,
  formatInstructionsAsUserMessage,
  requiresUserMessageInjection,
  INSTRUCTIONS_PREFIX,
} from "./agent-driver-types";

// Agent driver
export {
  AgentDriver,
  createCoderDriver,
  createReviewerDriver,
  createModelAuthConfig,
  type SerializedAgentDriver,
} from "./agent-driver";

// Prompt builder
export {
  buildCoderPrompt,
  buildReviewerPrompt,
  buildPrompt,
  buildContextSeed,
} from "./prompt-builder";
