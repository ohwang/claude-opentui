/**
 * /copy — Copy the last assistant message to the clipboard.
 *
 * Uses platform-specific clipboard tools:
 *   macOS  → pbcopy
 *   Linux  → xclip -selection clipboard  (fallback: xsel --clipboard)
 *   WSL    → clip.exe
 */

import type { SlashCommand, CommandContext } from "../registry"

function getClipboardCmd(): { cmd: string; args: string[] } | null {
  const platform = process.platform
  if (platform === "darwin") return { cmd: "pbcopy", args: [] }
  if (platform === "linux") {
    // WSL exposes clip.exe
    if (process.env.WSL_DISTRO_NAME) return { cmd: "clip.exe", args: [] }
    return { cmd: "xclip", args: ["-selection", "clipboard"] }
  }
  if (platform === "win32") return { cmd: "clip.exe", args: [] }
  return null
}

async function copyToClipboard(text: string): Promise<void> {
  const clip = getClipboardCmd()
  if (!clip) throw new Error("Unsupported platform for clipboard access")

  const proc = Bun.spawn([clip.cmd, ...clip.args], {
    stdin: "pipe",
  })

  proc.stdin.write(text)
  proc.stdin.end()

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new Error(`Clipboard command exited with code ${exitCode}`)
  }
}

export const copyCommand: SlashCommand = {
  name: "copy",
  description: "Copy last assistant message to clipboard",
  aliases: ["cp"],
  execute: async (_args: string, ctx: CommandContext) => {
    const blocks = ctx.getBlocks?.()
    if (!blocks) {
      ctx.pushEvent({ type: "system_message", text: "Cannot access conversation history." })
      return
    }

    // Walk backwards to find the last assistant block
    let lastAssistantText: string | undefined
    for (let i = blocks.length - 1; i >= 0; i--) {
      const block = blocks[i]!
      if (block.type === "assistant" && block.text) {
        lastAssistantText = block.text
        break
      }
    }

    if (!lastAssistantText) {
      ctx.pushEvent({ type: "system_message", text: "No assistant message to copy." })
      return
    }

    try {
      await copyToClipboard(lastAssistantText)
      const preview = lastAssistantText.length > 80
        ? lastAssistantText.slice(0, 77) + "..."
        : lastAssistantText
      ctx.pushEvent({ type: "system_message", text: `Copied to clipboard (${lastAssistantText.length} chars): ${preview}` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      ctx.pushEvent({ type: "system_message", text: `Failed to copy: ${msg}` })
    }
  },
}
