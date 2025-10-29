# Multi-Agent Workflow Architecture

Design for orchestrating multiple agent instances with parallel execution, review, and debate patterns.

## Scenario

**Goal**: "Make a from-scratch bech32 implementation in zig. Use test vectors from the BIP. Have thorough testing and use a flake.nix environment."

**Workflow**:
1. Launch 3 yeet instances with different LLMs to implement independently
2. Launch 2 yeet instances with different LLMs to review all implementations
3. Have the 2 reviewers argue/debate until they reach consensus
4. Give consensus feedback to coding agents for revision
5. Iterate until reviewers approve and deem ready to merge

## Two-Level Architecture

### Level 1: `agentMachine` (current)
- Single-agent tool execution workflow
- Has `thinking` → `executingTool` states
- Manages conversation with one LLM
- Owns the tool execution loop
- **Is a reusable component** for workflows

### Level 2: `workflowMachine` (new)
- Orchestrates multiple `agentMachine` instances
- Handles parallel execution, reviews, debates, iterations
- Manages data flow between agents
- Doesn't know about tool execution details
- **Composes agents into patterns**

## Workflow State Machine Design

```typescript
workflowMachine = setup({
  types: {
    context: {
      // Input
      task: string,
      implementationModels: string[], // ["claude-sonnet-4-5", "gpt-4", "qwen3-coder"]
      reviewerModels: string[],        // ["claude-sonnet-4-5", "gpt-4"]
      
      // Outputs from each phase
      implementations: Map<agentId, {
        files: FileSnapshot[],
        output: string,
        workingDir: string
      }>,
      
      initialReviews: Map<reviewerId, string>,
      debateTranscript: Array<{ speaker: string, model: string, message: string }>,
      consensus: string | null,
      
      // Iteration control
      revisionCount: number,
      maxRevisions: number,
      approved: boolean,
    }
  },
  
  actors: {
    // Re-use the existing agent machine
    codingAgent: agentMachine,
    reviewAgent: agentMachine,
    
    // New: coordinates the debate between 2 reviewers
    debateCoordinator: fromPromise(async ({ input }) => {
      // Alternates between reviewer 1 and reviewer 2
      // Returns: { consensus: string, transcript: Message[] }
    })
  }
  
}).createMachine({
  id: "parallel-review-workflow",
  initial: "parallel-implementation",
  
  states: {
    //
    // PHASE 1: Parallel Implementation
    //
    "parallel-implementation": {
      type: "parallel", // XState's parallel state!
      
      states: {
        agent1: {
          initial: "working",
          states: {
            working: {
              invoke: {
                src: "codingAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/impl-agent-1",
                  initialMessage: context.task,
                  model: context.implementationModels[0],
                }),
                onDone: {
                  target: "done",
                  actions: assign({
                    implementations: ({ context, event }) => 
                      context.implementations.set("agent1", {
                        files: event.output.files,
                        output: event.output.finalMessage,
                        workingDir: "/tmp/impl-agent-1"
                      })
                  })
                },
                onError: "error"
              }
            },
            done: { type: "final" },
            error: { type: "final" }
          }
        },
        
        agent2: {
          // Same structure, different model and working dir
          initial: "working",
          states: {
            working: {
              invoke: {
                src: "codingAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/impl-agent-2",
                  initialMessage: context.task,
                  model: context.implementationModels[1],
                })
              }
            },
            done: { type: "final" },
            error: { type: "final" }
          }
        },
        
        agent3: {
          // Same structure, third model
        }
      },
      
      // When all 3 agents reach final state (done or error)
      onDone: "consolidate-implementations"
    },
    
    //
    // PHASE 2: Prepare Review Context
    //
    "consolidate-implementations": {
      entry: assign({
        // Prepare a summary of all implementations for reviewers
        reviewContext: ({ context }) => {
          const impls = Array.from(context.implementations.entries());
          return formatImplementationsForReview(impls);
        }
      }),
      always: "initial-review"
    },
    
    //
    // PHASE 3: Initial Review (parallel)
    //
    "initial-review": {
      type: "parallel",
      
      states: {
        reviewer1: {
          initial: "reviewing",
          states: {
            reviewing: {
              invoke: {
                src: "reviewAgent",
                input: ({ context }) => ({
                  workingDirectory: "/tmp/review-1",
                  initialMessage: 
                    `Review these 3 implementations:\n\n${context.reviewContext}\n\n` +
                    `Provide detailed critique focusing on correctness, test coverage, and code quality.`,
                  model: context.reviewerModels[0],
                }),
                onDone: {
                  target: "done",
                  actions: assign({
                    initialReviews: ({ context, event }) =>
                      context.initialReviews.set("reviewer1", event.output.finalMessage)
                  })
                }
              }
            },
            done: { type: "final" }
          }
        },
        
        reviewer2: {
          // Similar structure, different model
        }
      },
      
      onDone: "debate"
    },
    
    //
    // PHASE 4: Argumentation / Debate
    //
    "debate": {
      invoke: {
        src: "debateCoordinator",
        input: ({ context }) => ({
          implementations: context.implementations,
          initialReviews: context.initialReviews,
          reviewerModels: context.reviewerModels,
          maxRounds: 5
        }),
        onDone: {
          actions: assign({
            debateTranscript: ({ event }) => event.output.transcript,
            consensus: ({ event }) => event.output.consensus
          }),
          target: "select-revision-strategy"
        }
      }
    },
    
    //
    // PHASE 5: Decide Revision Strategy
    //
    "select-revision-strategy": {
      always: [
        {
          // If consensus says implementations are good enough
          guard: ({ context }) => context.consensus.includes("APPROVE"),
          target: "complete"
        },
        {
          // Pick best implementation to revise
          guard: ({ context }) => context.consensus.includes("REVISE_BEST"),
          actions: assign({ selectedAgent: "best" }),
          target: "revision"
        },
        {
          // Have all 3 revise based on feedback
          guard: ({ context }) => context.consensus.includes("REVISE_ALL"),
          actions: assign({ selectedAgent: "all" }),
          target: "revision"
        },
        {
          // Default: revise the first one
          target: "revision"
        }
      ]
    },
    
    //
    // PHASE 6: Revision
    //
    "revision": {
      invoke: {
        src: "codingAgent",
        input: ({ context }) => ({
          workingDirectory: "/tmp/impl-agent-1", // or selected agent's dir
          initialMessage: 
            `${context.task}\n\n` +
            `Previous implementation:\n${context.implementations.get("agent1")?.output}\n\n` +
            `Reviewer consensus:\n${context.consensus}\n\n` +
            `Please revise based on the feedback.`,
          model: context.implementationModels[0],
        }),
        onDone: {
          actions: assign({
            implementations: ({ context, event }) =>
              context.implementations.set("agent1-revised", event.output),
            revisionCount: ({ context }) => context.revisionCount + 1
          }),
          target: "check-iteration"
        }
      }
    },
    
    //
    // PHASE 7: Check if we should iterate
    //
    "check-iteration": {
      always: [
        {
          guard: ({ context }) => context.revisionCount >= context.maxRevisions,
          target: "complete"
        },
        {
          // Go back to review with the revised implementation
          target: "final-review"
        }
      ]
    },
    
    //
    // PHASE 8: Final Review (after revision)
    //
    "final-review": {
      invoke: {
        src: "debateCoordinator",
        input: ({ context }) => ({
          implementations: new Map([
            ["agent1-revised", context.implementations.get("agent1-revised")]
          ]),
          reviewerModels: context.reviewerModels,
          maxRounds: 3, // Shorter debate for final review
          checkApproval: true
        }),
        onDone: [
          {
            guard: ({ event }) => event.output.approved,
            actions: assign({ approved: true }),
            target: "complete"
          },
          {
            actions: assign({
              consensus: ({ event }) => event.output.consensus,
              revisionCount: ({ context }) => context.revisionCount + 1
            }),
            target: "revision"
          }
        ]
      }
    },
    
    //
    // PHASE 9: Complete
    //
    complete: {
      type: "final",
      entry: "notifyComplete"
    }
  }
});
```

## Key Component: Debate Coordinator

The crucial piece that enables the argumentation pattern:

```typescript
const debateCoordinator = fromPromise(async ({ input }) => {
  const {
    implementations,
    initialReviews,
    reviewerModels,
    maxRounds,
    checkApproval = false
  } = input;
  
  const transcript = [];
  
  // Load initial reviews into conversation
  transcript.push({
    speaker: "reviewer1",
    model: reviewerModels[0],
    message: initialReviews.get("reviewer1")
  });
  transcript.push({
    speaker: "reviewer2",
    model: reviewerModels[1],
    message: initialReviews.get("reviewer2")
  });
  
  let consensusReached = false;
  let consensus = null;
  let approved = false;
  
  // Debate loop
  for (let round = 0; round < maxRounds && !consensusReached; round++) {
    console.log(`Debate round ${round + 1}/${maxRounds}`);
    
    // Reviewer 1's turn
    const r1Actor = createActor(agentMachine, {
      input: {
        workingDirectory: "/tmp/debate-r1",
        initialMessage: formatDebatePrompt({
          role: "reviewer1",
          transcript,
          round,
          checkApproval
        }),
        model: reviewerModels[0]
      }
    });
    
    const r1Response = await new Promise((resolve) => {
      r1Actor.subscribe((state) => {
        if (state.matches("idle") && state.context.messages.length > 0) {
          resolve(state.context.messages[state.context.messages.length - 1].content);
          r1Actor.stop();
        }
      });
      r1Actor.start();
    });
    
    transcript.push({
      speaker: "reviewer1",
      model: reviewerModels[0],
      message: r1Response
    });
    
    // Check for consensus keywords
    if (detectConsensus(r1Response, checkApproval)) {
      consensus = extractConsensus(r1Response);
      approved = extractApproval(r1Response);
      consensusReached = true;
      break;
    }
    
    // Reviewer 2's turn
    const r2Actor = createActor(agentMachine, {
      input: {
        workingDirectory: "/tmp/debate-r2",
        initialMessage: formatDebatePrompt({
          role: "reviewer2",
          transcript,
          round,
          checkApproval
        }),
        model: reviewerModels[1]
      }
    });
    
    const r2Response = await new Promise((resolve) => {
      r2Actor.subscribe((state) => {
        if (state.matches("idle") && state.context.messages.length > 0) {
          resolve(state.context.messages[state.context.messages.length - 1].content);
          r2Actor.stop();
        }
      });
      r2Actor.start();
    });
    
    transcript.push({
      speaker: "reviewer2",
      model: reviewerModels[1],
      message: r2Response
    });
    
    if (detectConsensus(r2Response, checkApproval)) {
      consensus = extractConsensus(r2Response);
      approved = extractApproval(r2Response);
      consensusReached = true;
      break;
    }
  }
  
  // If no consensus reached, synthesize one
  if (!consensusReached) {
    consensus = await synthesizeConsensus(transcript, reviewerModels[0]);
  }
  
  return { transcript, consensus, approved };
});

function formatDebatePrompt({ role, transcript, round, checkApproval }) {
  const otherRole = role === "reviewer1" ? "reviewer2" : "reviewer1";
  const lastMessage = transcript[transcript.length - 1];
  
  let prompt = `You are ${role} in a code review debate. You've been reviewing implementations.\n\n`;
  
  if (checkApproval) {
    prompt += `This is a final approval check. Review the revised implementation and either:\n`;
    prompt += `1. Approve it (respond with "APPROVE: reason")\n`;
    prompt += `2. Request more changes (respond with "REVISE: specific changes needed")\n\n`;
  } else {
    prompt += `Debate with ${otherRole} to reach consensus on:\n`;
    prompt += `1. Which implementation is best (or hybrid approach)\n`;
    prompt += `2. What specific changes are needed\n`;
    prompt += `3. Priority of changes\n\n`;
  }
  
  prompt += `Previous exchanges:\n`;
  for (const msg of transcript.slice(-4)) { // Last 4 messages for context
    prompt += `${msg.speaker}: ${msg.message}\n\n`;
  }
  
  if (round > 0) {
    prompt += `${otherRole} just said: ${lastMessage.message}\n\n`;
    prompt += `Respond to their points. `;
  }
  
  if (!checkApproval) {
    prompt += `If you reach agreement, start your response with "CONSENSUS: ".`;
  }
  
  return prompt;
}
```

## Key Design Decisions

### 1. Parallel States for Concurrent Work
- XState's `type: "parallel"` naturally models 3 agents working simultaneously
- Each agent is independent until they all finish
- `onDone` fires when all parallel states reach final

### 2. Debate as Promise-based Coordinator
- Could be a sub-machine, but Promise is simpler for MVP
- Manually alternates between two `agentMachine` invocations
- Builds up conversation history
- Detects consensus through keyword matching or max rounds

### 3. Context-based Data Flow
- Implementations stored in context as Map
- Each phase reads from previous phase's context
- Clear data lineage through the workflow

### 4. Flexible Revision Strategy
- Can revise one agent or all three
- Can pick "best" based on reviewer feedback
- Iteration limit prevents infinite loops

### 5. Two Review Cycles
- Initial review → debate → consensus (first pass)
- Final review → shorter debate → approve/revise (after revision)

## Implementation Requirements

### 1. Modify `agentMachine` to accept initial context
- Currently starts in idle, but we need to inject a task
- Add `initialMessage` to input
- Trigger USER_MESSAGE on start or have an entry action

### 2. Working directory isolation
- Each agent needs its own filesystem space
- Pass `workingDirectory` through to tool executors
- Ensure bash, write, edit tools respect workingDirectory

### 3. File snapshot/comparison utilities
- `formatImplementationsForReview()`: Format implementations for review
- Extract files from completed agents
- Maybe use the `FilesystemSnapshot` we already have

### 4. Consensus detection helpers
- `detectConsensus()`: regex for "CONSENSUS:", "APPROVE:", etc.
- `extractConsensus()`: parse the actual consensus text
- `extractApproval()`: parse approval boolean
- `synthesizeConsensus()`: if agents don't reach agreement, have one synthesize

### 5. Debate prompt engineering
- Format debate turns clearly
- Include just enough context (last N messages)
- Clear termination criteria

## Open Questions

### 1. How to handle agent failures?
- If 1 of 3 implementations crashes, do we continue with 2?
- Timeout handling for slow agents
- Should failures bubble up or be captured in context?

### 2. How to "pick the best" implementation?
- Could ask reviewers to rank them
- Could run test suites and compare
- Could be manual user choice
- Could be LLM-based synthesis of best parts

### 3. Workspace merging?
- Do we merge all 3 implementations into one workspace for revision?
- Or keep them separate and cherry-pick?
- How to handle file conflicts?

### 4. GUI visualization?
- How to show parallel agents in the flow graph?
- How to visualize the debate transcript?
- Maybe a split-screen for parallel states?
- Live streaming of multiple agents?

## Implementation Plan

### Phase 1: Simple 2-agent workflow
- 1 implementation + 1 review (no debate yet)
- Get the data flow working
- Test working directory isolation

### Phase 2: Add debate coordinator
- Test with 2 reviewers arguing about a fixed implementation
- Tune consensus detection
- Refine prompts

### Phase 3: Scale up to full workflow
- Add parallel implementation (3 agents)
- Add revision loop
- Test full cycle

### Phase 4: GUI integration (later)
- Visualize nested/parallel states
- Show debate transcript in UI
- Real-time updates during long workflows

## Benefits of This Design

1. **Clean Separation**: Agent-level (tool execution) vs workflow-level (multi-agent coordination)
2. **Composability**: `agentMachine` is reusable for any role (coder, reviewer, debater)
3. **Flexibility**: Easy to swap models, add more agents, change debate rules
4. **Observability**: XState gives us full visibility into workflow state
5. **Testability**: Can test workflow logic separately from agent execution
6. **Extensibility**: Easy to add new workflow patterns (racing, voting, etc.)
