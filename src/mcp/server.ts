/**
 * MCP Diagnostics Server — exposes TUI internal state as MCP tools.
 *
 * Two transports:
 *   1. HTTP via Bun.serve() — for external clients (curl, MCP Inspector)
 *   2. In-process SDK transport — for the Claude adapter (Phase 2)
 *
 * Port is written to ~/.claude-opentui/mcp-servers.json for discoverability.
 */

import { join, dirname } from "path"
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "fs"
import { homedir } from "os"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk"
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk"
import { getState, getConversation, getLogs, getScreenshot, getDiagnostics } from "./tools"

const SERVERS_FILE = join(homedir(), ".claude-opentui", "mcp-servers.json")

// ---------------------------------------------------------------------------
// HTTP server state
// ---------------------------------------------------------------------------

let _httpServer: ReturnType<typeof Bun.serve> | null = null
let _mcpServer: McpServer | null = null

// ---------------------------------------------------------------------------
// SDK in-process server (Phase 2)
// ---------------------------------------------------------------------------

let _sdkConfig: McpSdkServerConfigWithInstance | null = null

export function getDiagnosticsSdkMcpConfig(): McpSdkServerConfigWithInstance | null {
  if (_sdkConfig) return _sdkConfig

  _sdkConfig = createSdkMcpServer({
    name: "opentui-diagnostics",
    version: "0.0.1",
    tools: [
      tool("get_state", "Get current session state: lifecycle stage, model, cost/tokens, rate limits, turn number, error state", {}, async () => getState()),
      tool("get_conversation", "Get conversation blocks: messages, tool uses, thinking blocks, errors", {
        last_n: z.number().optional().describe("Return only the last N blocks"),
        type_filter: z.string().optional().describe("Filter by block type: user, assistant, tool, thinking, system, compact, shell, error"),
      }, async (args) => getConversation(args)),
      tool("get_logs", "Get recent log entries from the session logger", {
        level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Minimum log level to include"),
        last_n: z.number().optional().describe("Return only the last N lines (default: 50)"),
      }, async (args) => getLogs(args)),
      tool("get_screenshot", "Capture the current terminal screen as plain text", {}, async () => getScreenshot()),
      tool("get_diagnostics", "Get full diagnostics: system/memory, git, backend capabilities, context window, conversation stats", {}, async () => getDiagnostics()),
    ],
  })

  return _sdkConfig
}

// ---------------------------------------------------------------------------
// HTTP MCP server (for external clients)
// ---------------------------------------------------------------------------

function registerHttpTools(server: McpServer): void {
  server.registerTool("get_state", {
    description: "Get current session state: lifecycle stage, model, cost/tokens, rate limits, turn number, error state",
  }, async () => getState())

  server.registerTool("get_conversation", {
    description: "Get conversation blocks: messages, tool uses, thinking blocks, errors",
    inputSchema: {
      last_n: z.number().optional().describe("Return only the last N blocks"),
      type_filter: z.string().optional().describe("Filter by block type: user, assistant, tool, thinking, system, compact, shell, error"),
    },
  }, async (args) => getConversation(args))

  server.registerTool("get_logs", {
    description: "Get recent log entries from the session logger",
    inputSchema: {
      level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Minimum log level to include"),
      last_n: z.number().optional().describe("Return only the last N lines (default: 50)"),
    },
  }, async (args) => getLogs(args))

  server.registerTool("get_screenshot", {
    description: "Capture the current terminal screen as plain text",
  }, async () => getScreenshot())

  server.registerTool("get_diagnostics", {
    description: "Get full diagnostics: system/memory, git, backend capabilities, context window, conversation stats",
  }, async () => getDiagnostics())
}

export async function startMcpHttpServer(): Promise<{ port: number; url: string }> {
  const mcpServer = new McpServer(
    { name: "opentui-diagnostics", version: "0.0.1" },
    { capabilities: { tools: {} } },
  )
  registerHttpTools(mcpServer)

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  })

  await mcpServer.connect(transport)

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url)
      if (url.pathname === "/mcp") {
        return transport.handleRequest(req)
      }
      return new Response("Not Found", { status: 404 })
    },
  })

  _httpServer = server
  _mcpServer = mcpServer

  const port = server.port!
  const mcpUrl = `http://localhost:${port}/mcp`

  // Write port file
  writePortEntry("diagnostics", { port, url: mcpUrl, pid: process.pid })

  return { port, url: mcpUrl }
}

export async function stopMcpHttpServer(): Promise<void> {
  if (_httpServer) {
    _httpServer.stop()
    _httpServer = null
  }
  if (_mcpServer) {
    await _mcpServer.close().catch(() => {})
    _mcpServer = null
  }

  removePortEntry("diagnostics")
}

// ---------------------------------------------------------------------------
// Port file management (~/.claude-opentui/mcp-servers.json)
// ---------------------------------------------------------------------------

function readPortFile(): Record<string, unknown> {
  try {
    const data = readFileSync(SERVERS_FILE, "utf-8")
    return JSON.parse(data) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writePortEntry(name: string, entry: { port: number; url: string; pid: number }): void {
  const data = readPortFile()
  data[name] = entry
  mkdirSync(dirname(SERVERS_FILE), { recursive: true })
  writeFileSync(SERVERS_FILE, JSON.stringify(data, null, 2))
}

function removePortEntry(name: string): void {
  const data = readPortFile()
  delete data[name]
  if (Object.keys(data).length === 0) {
    try { unlinkSync(SERVERS_FILE) } catch { /* ignore */ }
  } else {
    try { writeFileSync(SERVERS_FILE, JSON.stringify(data, null, 2)) } catch { /* ignore */ }
  }
}
