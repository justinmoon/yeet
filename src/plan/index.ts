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

// Orchestration tools
export type { ToolAction } from "./tools";
export {
  requestReview,
  requestChanges,
  approve,
  createAskUserTool,
  createCoderTools,
  createReviewerTools,
  getToolsForRole,
} from "./tools";

// Tool executor
export type {
  StepResolver,
  UserPromptHandler,
  ToolExecutionResult,
} from "./tool-executor";
export {
  ToolExecutor,
  createArrayStepResolver,
  createPlanBodyStepResolver,
} from "./tool-executor";

// Tool filtering (read-only enforcement)
export type { ToolFilterResult } from "./tool-filter";
export {
  WRITE_TOOL_NAMES,
  WRITE_BASH_PATTERNS,
  isWriteTool,
  isWriteBashCommand,
  createToolFilter,
  filterToolsForRole,
  createReadOnlyInterceptor,
} from "./tool-filter";

// UI state management
export type {
  OrchestrationUIState,
  OrchestrationUIEvent,
} from "./ui-state";
export {
  DEFAULT_ORCHESTRATION_UI_STATE,
  createOrchestrationUIState,
  reduceOrchestrationUIState,
} from "./ui-state";

// UI rendering
export {
  orchestrationColors,
  formatOrchestrationStatus,
  formatAgentPrefix,
  formatAgentMessage,
  formatAgentToolCall,
  formatAskUserPrompt,
  formatStepHeader,
  formatStepApproved,
  formatChangeRequest,
  formatLoopGuardWarning,
  formatError,
  formatOrchestrationStarted,
  formatOrchestrationComplete,
  formatAgentTransition,
  createOrchestrationStatusText,
} from "./ui-renderer";
