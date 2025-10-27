/**
 * E2E test: Write and run a FizzBuzz program
 * 
 * Tests both OpenCode Zen and Maple AI by having the agent:
 * 1. Write a fizzbuzz program to disk
 * 2. Run it and verify output
 * 
 * NO MOCKS - uses real inference
 */

import { test, expect } from "bun:test"
import { runAgent } from "../src/agent"
import type { Config } from "../src/config"
import { loadConfig } from "../src/config"
import path from "path"
import { rm } from "fs/promises"

// Test timeout - agent tasks can take a while
const TEST_TIMEOUT = 120_000 // 2 minutes

// Expected fizzbuzz output for 1-15
const EXPECTED_OUTPUT = `1
2
Fizz
4
Buzz
Fizz
7
8
Fizz
Buzz
11
Fizz
13
14
FizzBuzz`

async function runFizzBuzzTest(config: Config, testName: string) {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`Starting: ${testName}`)
  console.log(`Provider: ${config.activeProvider}`)
  console.log(`Model: ${config.activeProvider === "opencode" ? config.opencode.model : config.maple?.model}`)
  console.log("=".repeat(60))

  const testDir = `/tmp/yeet-fizzbuzz-test-${Date.now()}`
  const fizzBuzzFile = path.join(testDir, "fizzbuzz.js")

  try {
    // Create test directory
    await Bun.write(path.join(testDir, ".gitkeep"), "")

    const messages = [
      {
        role: "user" as const,
        content: `Write a fizzbuzz program to ${fizzBuzzFile} that prints numbers 1-15, with Fizz for multiples of 3, Buzz for multiples of 5, and FizzBuzz for multiples of both. Then run it with "node ${fizzBuzzFile}".`
      }
    ]

    let assistantResponse = ""
    let toolCalls: Array<{ name: string; args: any }> = []
    let toolResults: Array<{ name: string; result: any }> = []
    let textChunks = 0
    let finalOutput = ""

    console.log("\n📤 User message:", messages[0].content)
    console.log("\n🤖 Agent starting...\n")

    for await (const event of runAgent(messages, config)) {
      if (event.type === "text") {
        textChunks++
        const text = event.content || ""
        assistantResponse += text
        process.stdout.write(text)
      } 
      else if (event.type === "tool") {
        toolCalls.push({ name: event.name, args: event.args })
        console.log(`\n🔧 [${event.name}]`, JSON.stringify(event.args, null, 2))
      } 
      else if (event.type === "tool-result") {
        toolResults.push({ name: event.name, result: event.result })
        
        if (typeof event.result === "string") {
          console.log(`✅ Result: ${event.result.substring(0, 200)}`)
        } else if (event.result?.stdout) {
          const stdout = event.result.stdout.trim()
          console.log(`✅ stdout:\n${stdout}`)
          
          // Capture the final output from bash execution
          if (event.name === "bash" && stdout) {
            finalOutput = stdout
          }
          
          if (event.result.stderr) {
            console.log(`⚠️  stderr: ${event.result.stderr}`)
          }
          if (event.result.exitCode !== 0) {
            console.log(`❌ Exit code: ${event.result.exitCode}`)
          }
        } else {
          console.log(`✅ Result:`, JSON.stringify(event.result, null, 2).substring(0, 200))
        }
      } 
      else if (event.type === "error") {
        console.log(`\n❌ Error: ${event.error}`)
        throw new Error(`Agent error: ${event.error}`)
      }
      else if (event.type === "done") {
        console.log("\n\n✨ Agent completed")
      }
    }

    console.log(`\n📊 Stats:`)
    console.log(`  Text chunks: ${textChunks}`)
    console.log(`  Tool calls: ${toolCalls.length}`)
    console.log(`  Tools used: ${toolCalls.map(t => t.name).join(", ")}`)

    // Verify the agent actually did the work
    console.log("\n🔍 Verifying results...")

    // 1. Check that write tool was used
    const writeCalls = toolCalls.filter(t => t.name === "write")
    expect(writeCalls.length).toBeGreaterThan(0)
    console.log(`✓ Write tool called ${writeCalls.length} time(s)`)

    // 2. Check that the file path is correct
    const writeCall = writeCalls.find(t => t.args?.path === fizzBuzzFile)
    expect(writeCall).toBeDefined()
    console.log(`✓ Wrote to correct path: ${fizzBuzzFile}`)

    // 3. Check that bash tool was used to run the program
    const bashCalls = toolCalls.filter(t => t.name === "bash")
    expect(bashCalls.length).toBeGreaterThan(0)
    console.log(`✓ Bash tool called ${bashCalls.length} time(s)`)

    // 4. Check that the bash command ran the fizzbuzz file
    const runCall = bashCalls.find(t => 
      t.args?.command?.includes("fizzbuzz.js") || 
      t.args?.command?.includes("node")
    )
    expect(runCall).toBeDefined()
    console.log(`✓ Ran the fizzbuzz program`)

    // 5. Verify the output matches expected fizzbuzz output
    console.log("\n📝 Checking FizzBuzz output...")
    console.log("Expected:", EXPECTED_OUTPUT.split("\n").slice(0, 5).join(", "), "...")
    console.log("Got:", finalOutput.split("\n").slice(0, 5).join(", "), "...")
    
    expect(finalOutput.trim()).toBe(EXPECTED_OUTPUT.trim())
    console.log("✓ FizzBuzz output is correct!")

    // 6. Verify file was actually created
    const fileExists = await Bun.file(fizzBuzzFile).exists()
    expect(fileExists).toBe(true)
    console.log(`✓ File exists on disk: ${fizzBuzzFile}`)

    console.log(`\n✅ ${testName} PASSED\n`)
  } finally {
    // Cleanup
    try {
      await rm(testDir, { recursive: true, force: true })
      console.log(`🧹 Cleaned up test directory: ${testDir}`)
    } catch (e) {
      console.warn(`⚠️  Failed to cleanup: ${e}`)
    }
  }
}

test("FizzBuzz E2E with OpenCode Zen", async () => {
  const config = await loadConfig()
  
  // Ensure we're using OpenCode
  const opencodeConfig = {
    ...config,
    activeProvider: "opencode" as const,
  }

  await runFizzBuzzTest(opencodeConfig, "FizzBuzz with OpenCode Zen")
}, TEST_TIMEOUT)

test("FizzBuzz E2E with Maple AI - Qwen", async () => {
  const config = await loadConfig()

  if (!config.maple?.apiKey) {
    console.log("\n⏭️  Skipping Maple test - no Maple configuration found")
    console.log("   Add Maple config to ~/.yeet/config.json to run this test")
    return
  }

  // Try Qwen - from the config example
  const mapleConfig = {
    ...config,
    activeProvider: "maple" as const,
    maple: {
      ...config.maple,
      model: "qwen2-5-72b",
    }
  }

  await runFizzBuzzTest(mapleConfig, "FizzBuzz with Maple AI (Qwen 72B)")
}, TEST_TIMEOUT)

test("FizzBuzz E2E with Maple AI - Llama", async () => {
  const config = await loadConfig()

  if (!config.maple?.apiKey) {
    console.log("\n⏭️  Skipping Maple test - no Maple configuration found")
    return
  }

  // Try Llama 3.3 70B
  const mapleConfig = {
    ...config,
    activeProvider: "maple" as const,
    maple: {
      ...config.maple,
      model: "llama-3.3-70b", // Correct name with dots
    }
  }

  await runFizzBuzzTest(mapleConfig, "FizzBuzz with Maple AI (Llama 3.3 70B)")
}, TEST_TIMEOUT)

test("FizzBuzz E2E with Maple AI - GPT OSS 120B", async () => {
  const config = await loadConfig()

  if (!config.maple?.apiKey) {
    console.log("\n⏭️  Skipping Maple test - no Maple configuration found")
    return
  }

  const mapleConfig = {
    ...config,
    activeProvider: "maple" as const,
    maple: {
      ...config.maple,
      model: "gpt-oss-120b",
    }
  }

  await runFizzBuzzTest(mapleConfig, "FizzBuzz with Maple AI (GPT OSS 120B)")
}, TEST_TIMEOUT)

test("FizzBuzz E2E with Maple AI - DeepSeek R1", async () => {
  const config = await loadConfig()

  if (!config.maple?.apiKey) {
    console.log("\n⏭️  Skipping Maple test - no Maple configuration found")
    return
  }

  const mapleConfig = {
    ...config,
    activeProvider: "maple" as const,
    maple: {
      ...config.maple,
      model: "deepseek-r1-0528", // Correct name from frontend
    }
  }

  await runFizzBuzzTest(mapleConfig, "FizzBuzz with Maple AI (DeepSeek R1 671B)")
}, TEST_TIMEOUT)

test("FizzBuzz E2E with Maple AI - DeepSeek V3.1", async () => {
  const config = await loadConfig()

  if (!config.maple?.apiKey) {
    console.log("\n⏭️  Skipping Maple test - no Maple configuration found")
    return
  }

  const mapleConfig = {
    ...config,
    activeProvider: "maple" as const,
    maple: {
      ...config.maple,
      model: "deepseek-v31-terminus", // Correct name from frontend
    }
  }

  await runFizzBuzzTest(mapleConfig, "FizzBuzz with Maple AI (DeepSeek V3.1 Terminus)")
}, TEST_TIMEOUT)

test("FizzBuzz E2E with Maple AI - GPT-OSS", async () => {
  const config = await loadConfig()

  if (!config.maple?.apiKey) {
    console.log("\n⏭️  Skipping Maple test - no Maple configuration found")
    return
  }

  const mapleConfig = {
    ...config,
    activeProvider: "maple" as const,
    maple: {
      ...config.maple,
      model: "gpt-oss-120b",
    }
  }

  await runFizzBuzzTest(mapleConfig, "FizzBuzz with Maple AI (GPT-OSS 120B)")
}, TEST_TIMEOUT)

test("FizzBuzz E2E with Maple AI - Gemma 3", async () => {
  const config = await loadConfig()

  if (!config.maple?.apiKey) {
    console.log("\n⏭️  Skipping Maple test - no Maple configuration found")
    return
  }

  const mapleConfig = {
    ...config,
    activeProvider: "maple" as const,
    maple: {
      ...config.maple,
      model: "leon-se/gemma-3-27b-it-fp8-dynamic", // Full path from frontend
    }
  }

  await runFizzBuzzTest(mapleConfig, "FizzBuzz with Maple AI (Gemma 3 27B)")
}, TEST_TIMEOUT)
