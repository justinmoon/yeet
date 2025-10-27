import path from "path"
import os from "os"
import { appendFile, mkdir } from "fs/promises"

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

interface LogEntry {
  timestamp: string
  level: string
  message: string
  context?: Record<string, any>
}

class Logger {
  private logFile: string
  private minLevel: LogLevel
  private buffer: string[] = []
  private flushTimeout?: Timer

  constructor(logFile: string, minLevel: LogLevel = LogLevel.INFO) {
    this.logFile = logFile
    this.minLevel = minLevel
  }

  async init(): Promise<void> {
    const logDir = path.dirname(this.logFile)
    await mkdir(logDir, { recursive: true })
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.minLevel
  }

  private formatEntry(entry: LogEntry): string {
    const contextStr = entry.context ? ` ${JSON.stringify(entry.context)}` : ""
    return `[${entry.timestamp}] ${entry.level.padEnd(5)} ${entry.message}${contextStr}\n`
  }

  private async write(level: LogLevel, levelName: string, message: string, context?: Record<string, any>): Promise<void> {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
      context,
    }

    const line = this.formatEntry(entry)
    this.buffer.push(line)

    // Debounced flush
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
    }
    this.flushTimeout = setTimeout(() => this.flush(), 100)
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const lines = this.buffer.join("")
    this.buffer = []

    try {
      await appendFile(this.logFile, lines)
    } catch (error) {
      // Can't log errors in the logger without creating infinite loops
      // Just fail silently
    }
  }

  debug(message: string, context?: Record<string, any>): void {
    this.write(LogLevel.DEBUG, "DEBUG", message, context)
  }

  info(message: string, context?: Record<string, any>): void {
    this.write(LogLevel.INFO, "INFO", message, context)
  }

  warn(message: string, context?: Record<string, any>): void {
    this.write(LogLevel.WARN, "WARN", message, context)
  }

  error(message: string, context?: Record<string, any>): void {
    this.write(LogLevel.ERROR, "ERROR", message, context)
  }

  async close(): Promise<void> {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout)
    }
    await this.flush()
  }
}

// Global logger instance
const logPath = path.join(os.homedir(), ".yeet", "debug.log")
const logLevel = process.env.YEET_LOG_LEVEL === "debug" ? LogLevel.DEBUG : LogLevel.INFO

export const logger = new Logger(logPath, logLevel)

// Initialize on import
logger.init().catch(() => {})

// Flush on process exit
process.on("exit", () => {
  // Synchronous flush on exit
  logger.close()
})
