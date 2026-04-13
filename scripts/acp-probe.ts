/**
 * ACP Protocol Probe for Gemini CLI
 *
 * Spawns `gemini --acp`, performs the ACP handshake, sends prompts,
 * and logs every protocol message exchanged. Used to validate
 * assumptions before building the ACP backend.
 *
 * Protocol reference: https://agentclientprotocol.com
 */

import { spawn } from "child_process"
import { readFileSync } from "fs"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const GEMINI_CMD = "gemini"
const GEMINI_ARGS = ["--acp"]
const TIMEOUT_MS = 120_000 // 2 min max per operation

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

let nextId = 1

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function makeRequest(method: string, params?: unknown): { id: number; msg: JsonRpcMessage } {
  const id = nextId++
  return {
    id,
    msg: { jsonrpc: "2.0", id, method, params: params ?? {} },
  }
}

function makeResponse(id: number | string, result: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", id, result }
}

function makeErrorResponse(id: number | string, code: number, message: string): JsonRpcMessage {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function makeNotification(method: string, params?: unknown): JsonRpcMessage {
  return { jsonrpc: "2.0", method, params: params ?? {} }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

type MessageHandler = (msg: JsonRpcMessage) => void

let child: ReturnType<typeof spawn>
let onMessage: MessageHandler = () => {}
let buffer = ""
const allMessages: { direction: "send" | "recv"; ts: number; msg: JsonRpcMessage }[] = []

function startTransport() {
  console.log(`\n=== Spawning: ${GEMINI_CMD} ${GEMINI_ARGS.join(" ")} ===\n`)
  child = spawn(GEMINI_CMD, GEMINI_ARGS, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString()
    console.log(`[stderr] ${text.trimEnd()}`)
  })

  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString()
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line) as JsonRpcMessage
        allMessages.push({ direction: "recv", ts: Date.now(), msg })
        console.log(`<-- RECV: ${JSON.stringify(msg)}`)
        onMessage(msg)
      } catch {
        console.log(`[stdout non-json] ${line}`)
      }
    }
  })

  child.on("exit", (code, signal) => {
    console.log(`\n=== Process exited: code=${code} signal=${signal} ===`)
  })
}

function send(msg: JsonRpcMessage) {
  const line = JSON.stringify(msg) + "\n"
  allMessages.push({ direction: "send", ts: Date.now(), msg })
  console.log(`--> SEND: ${JSON.stringify(msg)}`)
  child.stdin?.write(line)
}

function waitForResponse(id: number | string, timeoutMs = TIMEOUT_MS): Promise<JsonRpcMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for response id=${id}`)), timeoutMs)
    const prev = onMessage
    onMessage = (msg) => {
      prev(msg)
      if (msg.id === id && (msg.result !== undefined || msg.error !== undefined)) {
        clearTimeout(timer)
        onMessage = prev
        resolve(msg)
      }
    }
  })
}

/**
 * Collect all messages until either:
 * 1. A response to our request arrives (id match with result/error)
 * 2. A timeout fires
 *
 * Also handles server-initiated requests (like fs/ or permission requests)
 * by responding to them automatically.
 */
function collectUntilResponse(
  requestId: number | string,
  timeoutMs: number,
  opts: { handleFs?: boolean } = {},
): Promise<JsonRpcMessage[]> {
  return new Promise((resolve) => {
    const collected: JsonRpcMessage[] = []
    const prev = onMessage
    const timer = setTimeout(() => {
      onMessage = prev
      resolve(collected)
    }, timeoutMs)

    onMessage = (msg) => {
      prev(msg)
      collected.push(msg)

      // Handle server-initiated requests (has both id and method)
      if (msg.method && msg.id !== undefined) {
        console.log(`  *** SERVER REQUEST: ${msg.method} id=${msg.id} ***`)

        // Handle filesystem requests
        if (msg.method === "fs/read_text_file" && opts.handleFs) {
          const params = msg.params as any
          console.log(`  --> Reading file: ${params.path}`)
          try {
            const content = readFileSync(params.path, "utf-8")
            send(makeResponse(msg.id, { content }))
          } catch (err: any) {
            send(makeErrorResponse(msg.id, -32000, `File not found: ${params.path}`))
          }
        } else if (msg.method === "fs/write_text_file" && opts.handleFs) {
          // Don't actually write, just log and respond with error
          console.log(`  --> WRITE REQUEST (denied): ${(msg.params as any).path}`)
          send(makeErrorResponse(msg.id, -32000, "Write not supported in probe mode"))
        } else if (msg.method === "session/request_permission") {
          // Auto-approve permissions
          const params = msg.params as any
          const allowOption = params.options?.find((o: any) => o.kind === "allow_once")
          console.log(`  --> Auto-approving permission, options: ${JSON.stringify(params.options?.map((o: any) => o.kind))}`)
          send(makeResponse(msg.id, {
            outcome: {
              outcome: "selected",
              optionId: allowOption?.optionId ?? params.options?.[0]?.optionId ?? "allow",
            },
          }))
        } else {
          // Unknown server request — respond with method not found
          console.log(`  --> Unknown server request, responding with error`)
          send(makeErrorResponse(msg.id, -32601, `Method not supported: ${msg.method}`))
        }
      }

      // Response to our request — we're done
      if (msg.id === requestId && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
        clearTimeout(timer)
        onMessage = prev
        resolve(collected)
      }
    }
  })
}

// ---------------------------------------------------------------------------
// Probe steps
// ---------------------------------------------------------------------------

async function probe1_initialize(): Promise<any> {
  console.log("\n" + "=".repeat(60))
  console.log("PROBE 1: Initialize handshake (NO client capabilities)")
  console.log("=".repeat(60))

  const { id, msg } = makeRequest("initialize", {
    protocolVersion: 1,
    clientInfo: {
      name: "bantai-probe",
      version: "0.0.1",
    },
    // Deliberately empty — test what happens without fs/terminal caps
    clientCapabilities: {},
  })

  send(msg)
  const resp = await waitForResponse(id)

  if (resp.error) {
    console.log("\n--- Initialize FAILED ---")
    console.log(JSON.stringify(resp.error, null, 2))
    return null
  }

  const result = resp.result as any
  console.log("\n--- Server Info ---")
  console.log(JSON.stringify(result.agentInfo ?? result.serverInfo, null, 2))
  console.log("\n--- Protocol Version ---")
  console.log(result.protocolVersion)
  console.log("\n--- Agent Capabilities ---")
  console.log(JSON.stringify(result.agentCapabilities, null, 2))
  console.log("\n--- Session Modes ---")
  console.log(JSON.stringify(result.modes ?? result.sessionModes, null, 2))
  console.log("\n--- Config Options ---")
  console.log(JSON.stringify(result.configOptions, null, 2))
  console.log("\n--- Slash Commands ---")
  console.log(JSON.stringify(result.slashCommands, null, 2))
  console.log("\n--- Auth Methods ---")
  console.log(JSON.stringify(result.authMethods, null, 2))
  console.log("\n--- Full Result Keys ---")
  console.log(Object.keys(result))

  // Send initialized notification (per ACP spec)
  send(makeNotification("initialized"))

  return result
}

async function probe2_createSession(): Promise<string | null> {
  console.log("\n" + "=".repeat(60))
  console.log("PROBE 2: Create session (session/new)")
  console.log("=".repeat(60))

  const { id, msg } = makeRequest("session/new", {
    cwd: process.cwd(),
    mcpServers: [],
  })

  send(msg)
  const resp = await waitForResponse(id)

  if (resp.error) {
    console.log("\n--- Session create FAILED ---")
    console.log(JSON.stringify(resp.error, null, 2))
    return null
  }

  const result = resp.result as any
  console.log("\n--- Session create result ---")
  console.log(JSON.stringify(result, null, 2))

  return result?.sessionId ?? null
}

async function probe3_simplePrompt(sessionId: string): Promise<void> {
  console.log("\n" + "=".repeat(60))
  console.log("PROBE 3: Simple text prompt (no tools needed)")
  console.log("=".repeat(60))

  const { id, msg } = makeRequest("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "What is 2 + 2? Answer in one word." }],
  })

  send(msg)
  const messages = await collectUntilResponse(id, TIMEOUT_MS)

  console.log(`\n--- Collected ${messages.length} messages ---`)
  const updateTypes = new Set<string>()
  for (const m of messages) {
    if (m.method === "session/update") {
      const update = (m.params as any)?.update
      const type = update?.sessionUpdate ?? "unknown"
      updateTypes.add(type)
      if (type === "agent_message_chunk") {
        console.log(`  [agent_message_chunk] ${JSON.stringify(update.content).slice(0, 200)}`)
      } else {
        console.log(`  [${type}] ${JSON.stringify(update).slice(0, 200)}`)
      }
    } else if (m.method) {
      console.log(`  [${m.method}] ${JSON.stringify(m.params).slice(0, 200)}`)
    } else if (m.id === id) {
      console.log(`  [prompt result] ${JSON.stringify(m.result ?? m.error).slice(0, 200)}`)
    }
  }
  console.log(`\n--- Update types seen: ${[...updateTypes].join(", ")} ---`)
}

async function probe4_fileReadNoFs(sessionId: string): Promise<void> {
  console.log("\n" + "=".repeat(60))
  console.log("PROBE 4: File read prompt WITHOUT fs capabilities")
  console.log("  (Does Gemini use its own tools, or request fs/read_text_file?)")
  console.log("=".repeat(60))

  const { id, msg } = makeRequest("session/prompt", {
    sessionId,
    prompt: [
      {
        type: "text",
        text: "Read the file package.json in the current directory and tell me the project name. Just the name, nothing else.",
      },
    ],
  })

  send(msg)
  // Don't handle fs requests — we want to see if the agent even asks
  const messages = await collectUntilResponse(id, TIMEOUT_MS, { handleFs: false })

  console.log(`\n--- Collected ${messages.length} messages ---`)
  let sawFsRequest = false
  let sawToolCall = false
  let sawPermission = false
  const updateTypes = new Set<string>()

  for (const m of messages) {
    if (m.method?.startsWith("fs/")) {
      sawFsRequest = true
      console.log(`  *** FS REQUEST: ${m.method} ***`)
      console.log(`  params: ${JSON.stringify(m.params, null, 2)}`)
    } else if (m.method === "session/request_permission") {
      sawPermission = true
      console.log(`  *** PERMISSION REQUEST ***`)
      console.log(`  params: ${JSON.stringify(m.params).slice(0, 300)}`)
    } else if (m.method === "session/update") {
      const update = (m.params as any)?.update
      const type = update?.sessionUpdate ?? "unknown"
      updateTypes.add(type)
      if (type === "tool_call" || type === "tool_call_update") {
        sawToolCall = true
        console.log(`  [${type}] kind=${update.kind} title=${update.title} status=${update.status}`)
        if (update.content?.length) {
          console.log(`    content: ${JSON.stringify(update.content).slice(0, 200)}`)
        }
      } else {
        console.log(`  [${type}] ${JSON.stringify(update).slice(0, 200)}`)
      }
    } else if (m.id === id) {
      console.log(`  [prompt result] ${JSON.stringify(m.result ?? m.error).slice(0, 200)}`)
    }
  }

  console.log("\n--- CRITICAL FINDING ---")
  if (sawFsRequest) {
    console.log("RESULT: Gemini CLI DELEGATES file reads to the client via ACP fs/ methods.")
    console.log("IMPACT: We MUST implement fs capabilities for basic functionality.")
  } else if (sawToolCall) {
    console.log("RESULT: Gemini CLI handles file reads INTERNALLY via its own tools.")
    console.log("IMPACT: Client fs capabilities are NOT required for v1.")
  } else {
    console.log("RESULT: Neither fs request nor tool call observed.")
    if (sawPermission) {
      console.log("NOTE: Permission was requested — agent may have tools but we didn't approve them.")
    }
  }
  console.log(`Update types seen: ${[...updateTypes].join(", ")}`)
}

async function probe5_fileReadWithFs(sessionId: string): Promise<void> {
  console.log("\n" + "=".repeat(60))
  console.log("PROBE 5: File read prompt WITH fs request handling")
  console.log("  (Respond to fs/ requests to see full tool flow)")
  console.log("=".repeat(60))

  const { id, msg } = makeRequest("session/prompt", {
    sessionId,
    prompt: [
      {
        type: "text",
        text: "Can you read the file package.json and tell me the project name field? Just the name value.",
      },
    ],
  })

  send(msg)
  const messages = await collectUntilResponse(id, TIMEOUT_MS, { handleFs: true })

  console.log(`\n--- Collected ${messages.length} messages ---`)
  for (const m of messages) {
    if (m.method === "session/update") {
      const update = (m.params as any)?.update
      const type = update?.sessionUpdate ?? "unknown"
      if (type === "tool_call" || type === "tool_call_update") {
        console.log(`  [${type}] kind=${update.kind} title="${update.title}" status=${update.status}`)
        if (update.locations?.length) console.log(`    locations: ${JSON.stringify(update.locations)}`)
        if (update.content?.length) console.log(`    content: ${JSON.stringify(update.content).slice(0, 300)}`)
        if (update.rawInput) console.log(`    rawInput: ${JSON.stringify(update.rawInput).slice(0, 200)}`)
        if (update.rawOutput) console.log(`    rawOutput: ${JSON.stringify(update.rawOutput).slice(0, 200)}`)
      } else if (type === "agent_message_chunk") {
        console.log(`  [agent_message_chunk] ${JSON.stringify(update.content).slice(0, 200)}`)
      } else {
        console.log(`  [${type}] ${JSON.stringify(update).slice(0, 300)}`)
      }
    } else if (m.method?.startsWith("fs/")) {
      console.log(`  [${m.method}] ${JSON.stringify(m.params).slice(0, 200)}`)
    } else if (m.method === "session/request_permission") {
      console.log(`  [permission] ${JSON.stringify(m.params).slice(0, 300)}`)
    } else if (m.id === id) {
      console.log(`  [prompt result] ${JSON.stringify(m.result ?? m.error).slice(0, 300)}`)
    }
  }
}

async function probe6_cancel(sessionId: string): Promise<void> {
  console.log("\n" + "=".repeat(60))
  console.log("PROBE 6: Cancel a running prompt")
  console.log("=".repeat(60))

  const { id, msg } = makeRequest("session/prompt", {
    sessionId,
    prompt: [
      {
        type: "text",
        text: "Write a detailed 2000-word essay about the history of computing.",
      },
    ],
  })

  send(msg)

  // Wait 3 seconds for some streaming, then cancel
  const earlyMessages: JsonRpcMessage[] = []
  await new Promise<void>((resolve) => {
    const prev = onMessage
    const timer = setTimeout(() => {
      onMessage = prev
      resolve()
    }, 5000)

    onMessage = (msg) => {
      prev(msg)
      earlyMessages.push(msg)
    }
  })

  console.log(`\n--- Got ${earlyMessages.length} messages before cancel ---`)

  // Send cancel
  console.log("--- Sending session/cancel ---")
  const cancelReq = makeRequest("session/cancel", { sessionId })
  send(cancelReq.msg)

  // Collect remaining
  const remaining = await collectUntilResponse(id, 15_000)
  console.log(`\n--- Got ${remaining.length} messages after cancel ---`)

  // Check if we got a cancel response
  const cancelResp = allMessages.find(
    (m) => m.direction === "recv" && m.msg.id === cancelReq.id,
  )
  if (cancelResp) {
    console.log(`Cancel response: ${JSON.stringify(cancelResp.msg.result ?? cancelResp.msg.error)}`)
  }

  // Check the prompt result — should indicate cancellation
  const promptResp = [...earlyMessages, ...remaining].find(
    (m) => m.id === id && (m.result !== undefined || m.error !== undefined),
  )
  if (promptResp) {
    console.log(`Prompt result after cancel: ${JSON.stringify(promptResp.result ?? promptResp.error).slice(0, 300)}`)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("ACP Protocol Probe — Gemini CLI")
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`CWD: ${process.cwd()}`)
  console.log(`Gemini CLI: ${GEMINI_CMD} ${GEMINI_ARGS.join(" ")}`)

  startTransport()

  try {
    // Wait for process to start
    await new Promise((r) => setTimeout(r, 1000))

    // Probe 1: Initialize (no caps)
    const initResult = await probe1_initialize()
    if (!initResult) {
      console.log("\nFATAL: Initialize failed. Aborting.")
      child.kill("SIGTERM")
      process.exit(1)
    }

    // Probe 2: Create session
    const sessionId = await probe2_createSession()
    if (!sessionId) {
      console.log("\nFATAL: Could not create session. Aborting.")
      child.kill("SIGTERM")
      process.exit(1)
    }

    // Probe 3: Simple prompt
    await probe3_simplePrompt(sessionId)

    // Probe 4: File read without fs caps
    await probe4_fileReadNoFs(sessionId)

    // Probe 5: File read with fs handling
    await probe5_fileReadWithFs(sessionId)

    // Probe 6: Cancel
    await probe6_cancel(sessionId)
  } catch (err) {
    console.error("\nProbe error:", err)
  }

  // Dump full transcript
  console.log("\n" + "=".repeat(60))
  console.log("FULL PROTOCOL TRANSCRIPT")
  console.log("=".repeat(60))
  const startTs = allMessages[0]?.ts ?? 0
  for (const m of allMessages) {
    const dir = m.direction === "send" ? "-->" : "<--"
    const elapsed = ((m.ts - startTs) / 1000).toFixed(2)
    console.log(`[${elapsed}s] ${dir} ${JSON.stringify(m.msg)}`)
  }

  // Kill the process
  console.log("\n=== Killing Gemini process ===")
  child.kill("SIGTERM")
  setTimeout(() => process.exit(0), 3000)
}

main()
