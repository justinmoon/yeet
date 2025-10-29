/**
 * Debate coordinator for multi-agent workflows
 * Alternates between two reviewers until consensus is reached
 */

import { createActor } from "xstate";
import { type AgentContext, agentMachine } from "./agent-machine";

export interface DebateInput {
  implementations: Map<
    string,
    {
      messages: Array<{ role: string; content: string }>;
      workingDir: string;
      success: boolean;
      error?: string;
    }
  >;
  reviews: Map<string, string>;
  reviewerModels: string[];
  maxRounds: number;
  checkApproval?: boolean;
}

export interface DebateOutput {
  consensus: string;
  transcript: Array<{ speaker: string; model: string; message: string }>;
  approved: boolean;
}

/**
 * Format implementations for debate discussion
 */
function formatImplementationsForDebate(
  implementations: DebateInput["implementations"],
): string {
  let result = "## Implementations\n\n";
  let index = 1;

  for (const [agentId, impl] of implementations.entries()) {
    result += `### Implementation ${index} (${agentId})\n`;
    if (impl.success) {
      const lastMessage = impl.messages[impl.messages.length - 1];
      if (lastMessage) {
        result += `${lastMessage.content.substring(0, 500)}...\n\n`;
      }
    } else {
      result += `❌ Failed: ${impl.error}\n\n`;
    }
    index++;
  }

  return result;
}

/**
 * Format debate prompt for a reviewer
 */
function formatDebatePrompt(params: {
  role: string;
  otherRole: string;
  transcript: DebateOutput["transcript"];
  implementations: DebateInput["implementations"];
  round: number;
  checkApproval: boolean;
}): string {
  const { role, otherRole, transcript, implementations, round, checkApproval } =
    params;

  let prompt = `You are ${role} in a code review debate.\n\n`;

  if (checkApproval) {
    prompt += `This is a final approval check. Review the implementation and either:\n`;
    prompt += `1. Approve it: start response with "APPROVE: <reason>"\n`;
    prompt += `2. Request changes: start response with "REVISE: <specific changes needed>"\n\n`;
  } else {
    prompt += `Debate with ${otherRole} to reach consensus on:\n`;
    prompt += `1. Which implementation is best (or suggest hybrid approach)\n`;
    prompt += `2. What specific changes are needed\n`;
    prompt += `3. Priority of changes\n\n`;
    prompt += `When you reach agreement, start your response with "CONSENSUS: "\n\n`;
  }

  // Add implementations
  prompt += formatImplementationsForDebate(implementations);

  // Add recent debate history
  if (transcript.length > 0) {
    prompt += "\n## Debate History\n\n";
    const recentMessages = transcript.slice(-6); // Last 6 messages for context
    for (const msg of recentMessages) {
      prompt += `**${msg.speaker}** (${msg.model}):\n${msg.message}\n\n`;
    }

    if (round > 0) {
      const lastMessage = transcript[transcript.length - 1];
      prompt += `\n${otherRole} just responded. Address their points and move toward consensus.\n`;
    }
  }

  return prompt;
}

/**
 * Detect if consensus has been reached
 * Looks for keywords anywhere in the message, not just at the start
 */
function detectConsensus(
  message: string,
  checkApproval: boolean,
): { hasConsensus: boolean; approved: boolean; consensus: string | null } {
  const upperMessage = message.toUpperCase();

  if (checkApproval) {
    // Check for APPROVE: anywhere in message
    const approveIndex = upperMessage.indexOf("APPROVE:");
    if (approveIndex !== -1) {
      const consensusStart = message.indexOf(":", approveIndex) + 1;
      return {
        hasConsensus: true,
        approved: true,
        consensus: message.substring(consensusStart).trim(),
      };
    }

    // Check for REVISE: anywhere in message
    const reviseIndex = upperMessage.indexOf("REVISE:");
    if (reviseIndex !== -1) {
      const consensusStart = message.indexOf(":", reviseIndex) + 1;
      return {
        hasConsensus: true,
        approved: false,
        consensus: message.substring(consensusStart).trim(),
      };
    }
  } else {
    // Check for CONSENSUS: anywhere in message
    const consensusIndex = upperMessage.indexOf("CONSENSUS:");
    if (consensusIndex !== -1) {
      const consensusStart = message.indexOf(":", consensusIndex) + 1;
      return {
        hasConsensus: true,
        approved: false, // Will be determined in approval phase
        consensus: message.substring(consensusStart).trim(),
      };
    }
  }

  return { hasConsensus: false, approved: false, consensus: null };
}

/**
 * Run a single reviewer agent turn
 */
async function runReviewerTurn(params: {
  role: string;
  model: string;
  workingDir: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<string> {
  const { role, model, workingDir, prompt, timeoutMs = 60000 } = params;

  console.log(`  [${role}] Starting turn with ${model}...`);

  const actor = createActor(agentMachine, {
    input: {
      workingDirectory: workingDir,
      initialMessage: prompt,
      maxSteps: 20,
      workflowMode: true,
      model,
    },
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      actor.stop();
      reject(new Error(`${role} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    actor.subscribe((state) => {
      if (state.matches("complete")) {
        clearTimeout(timeout);
        actor.stop();

        const output = state.context as AgentContext;
        const lastMessage = output.messages[output.messages.length - 1];
        const response = lastMessage?.content || "";

        console.log(`  [${role}] Response: ${response.substring(0, 100)}...`);
        resolve(response);
      } else if (state.matches("error")) {
        clearTimeout(timeout);
        actor.stop();
        reject(new Error(`${role} encountered an error`));
      }
    });

    actor.start();
  });
}

/**
 * Coordinate a debate between two reviewers
 */
export async function coordinateDebate(
  input: DebateInput,
): Promise<DebateOutput> {
  const {
    implementations,
    reviews,
    reviewerModels,
    maxRounds,
    checkApproval = false,
  } = input;

  console.log(`\n🗣️  Starting debate coordinator (max ${maxRounds} rounds)`);
  console.log(`  Reviewers: ${reviewerModels.join(", ")}`);
  console.log(`  Check approval: ${checkApproval}`);

  const transcript: DebateOutput["transcript"] = [];

  // Add initial reviews to transcript if they exist
  if (reviews.size > 0) {
    const reviewer1Initial = reviews.get("reviewer1");
    if (reviewer1Initial) {
      transcript.push({
        speaker: "reviewer1",
        model: reviewerModels[0],
        message: reviewer1Initial,
      });
    }

    const reviewer2Initial = reviews.get("reviewer2");
    if (reviewer2Initial) {
      transcript.push({
        speaker: "reviewer2",
        model: reviewerModels[1],
        message: reviewer2Initial,
      });
    }
  }

  let consensusReached = false;
  let consensus: string | null = null;
  let approved = false;

  // Debate loop
  for (let round = 0; round < maxRounds && !consensusReached; round++) {
    console.log(`\n📍 Debate Round ${round + 1}/${maxRounds}`);

    // Reviewer 1's turn
    try {
      const r1Prompt = formatDebatePrompt({
        role: "reviewer1",
        otherRole: "reviewer2",
        transcript,
        implementations,
        round,
        checkApproval,
      });

      const r1Response = await runReviewerTurn({
        role: "reviewer1",
        model: reviewerModels[0],
        workingDir: `/tmp/debate-r1-${Date.now()}`,
        prompt: r1Prompt,
      });

      transcript.push({
        speaker: "reviewer1",
        model: reviewerModels[0],
        message: r1Response,
      });

      // Check for consensus
      const r1Check = detectConsensus(r1Response, checkApproval);
      if (r1Check.hasConsensus) {
        console.log(`  ✅ Reviewer1 reached consensus!`);
        consensus = r1Check.consensus;
        approved = r1Check.approved;
        consensusReached = true;
        break;
      }
    } catch (error) {
      console.error(`  ❌ Reviewer1 failed:`, error);
      transcript.push({
        speaker: "reviewer1",
        model: reviewerModels[0],
        message: `ERROR: ${error}`,
      });
    }

    // Reviewer 2's turn
    try {
      const r2Prompt = formatDebatePrompt({
        role: "reviewer2",
        otherRole: "reviewer1",
        transcript,
        implementations,
        round,
        checkApproval,
      });

      const r2Response = await runReviewerTurn({
        role: "reviewer2",
        model: reviewerModels[1],
        workingDir: `/tmp/debate-r2-${Date.now()}`,
        prompt: r2Prompt,
      });

      transcript.push({
        speaker: "reviewer2",
        model: reviewerModels[1],
        message: r2Response,
      });

      // Check for consensus
      const r2Check = detectConsensus(r2Response, checkApproval);
      if (r2Check.hasConsensus) {
        console.log(`  ✅ Reviewer2 reached consensus!`);
        consensus = r2Check.consensus;
        approved = r2Check.approved;
        consensusReached = true;
        break;
      }
    } catch (error) {
      console.error(`  ❌ Reviewer2 failed:`, error);
      transcript.push({
        speaker: "reviewer2",
        model: reviewerModels[1],
        message: `ERROR: ${error}`,
      });
    }
  }

  // If no consensus reached, synthesize one
  if (!consensusReached) {
    console.log(`  ⚠️  No consensus after ${maxRounds} rounds, synthesizing...`);
    consensus =
      "REVISE: Reviewers did not reach consensus. Suggest revising based on initial feedback.";
    approved = false;
  }

  console.log(`\n✅ Debate complete!`);
  console.log(`  Consensus: ${consensus?.substring(0, 100)}...`);
  console.log(`  Approved: ${approved}`);
  console.log(`  Transcript length: ${transcript.length} messages`);

  return {
    consensus: consensus || "",
    transcript,
    approved,
  };
}
