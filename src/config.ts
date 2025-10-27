import path from "path"
import os from "os"
import { mkdir, chmod } from "fs/promises"

export interface Config {
  opencode: {
    apiKey: string
    baseURL: string
    model: string
  }
  maxSteps?: number
  temperature?: number
}

async function tryLoadOpenCodeCredentials(): Promise<string | null> {
  try {
    // Try to load from OpenCode's auth.json
    const opencodeAuthPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json")
    const authFile = Bun.file(opencodeAuthPath)
    
    if (await authFile.exists()) {
      const authData = await authFile.json()
      if (authData.opencode?.type === "api" && authData.opencode.key) {
        return authData.opencode.key
      }
    }
  } catch (error) {
    // Ignore errors, will fall through to return null
  }
  return null
}

async function createDefaultConfig(configPath: string): Promise<Config> {
  const apiKey = await tryLoadOpenCodeCredentials()
  
  if (!apiKey) {
    throw new Error(
      `Could not find OpenCode credentials and no config exists.\n\n` +
        `Please create ${configPath} with:\n` +
        `mkdir -p ~/.yeet\n` +
        `cat > ~/.yeet/config.json << 'EOF'\n` +
        `{\n` +
        `  "opencode": {\n` +
        `    "apiKey": "your-opencode-zen-api-key",\n` +
        `    "baseURL": "https://opencode.ai/zen/v1",\n` +
        `    "model": "grok-code"\n` +
        `  }\n` +
        `}\n` +
        `EOF`
    )
  }

  const config: Config = {
    opencode: {
      apiKey,
      baseURL: "https://opencode.ai/zen/v1",
      model: "grok-code",  // Free model on OpenCode Zen
    },
    maxSteps: 5,
    temperature: 0.3,
  }

  // Create config directory if it doesn't exist
  await mkdir(path.dirname(configPath), { recursive: true })
  
  // Write config file
  await Bun.write(configPath, JSON.stringify(config, null, 2))
  
  // Set secure permissions
  await chmod(configPath, 0o600)
  
  console.log(`✓ Created config at ${configPath}`)
  console.log(`✓ Copied OpenCode API credentials`)
  console.log()
  
  return config
}

export async function loadConfig(): Promise<Config> {
  const configPath = path.join(os.homedir(), ".yeet", "config.json")
  const file = Bun.file(configPath)

  if (!(await file.exists())) {
    return await createDefaultConfig(configPath)
  }

  const config = (await file.json()) as Config
  return {
    ...config,
    maxSteps: config.maxSteps || 5,
    temperature: config.temperature || 0.3,
  }
}
