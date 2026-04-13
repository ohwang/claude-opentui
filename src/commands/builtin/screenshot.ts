/**
 * /screenshot — Capture the current terminal screen and save to a file.
 *
 * Outputs two formats:
 *   .txt  — plain text (characters only)
 *   .ans  — ANSI escape codes (colors + attributes, viewable with `cat`)
 */

import { join } from "path"
import { mkdirSync, writeFileSync } from "fs"
import { homedir } from "os"
import { TextAttributes } from "@opentui/core"
import type { CapturedLine } from "@opentui/core"
import type { SlashCommand, CommandContext } from "../registry"

const SCREENSHOT_DIR = join(homedir(), ".bantai", "screenshots")

function rgbaToAnsi(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`
}

function bgRgbaToAnsi(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`
}

function attrsToAnsi(attributes: number): string {
  const base = attributes & 0xff
  const codes: number[] = []
  if (base & TextAttributes.BOLD) codes.push(1)
  if (base & TextAttributes.DIM) codes.push(2)
  if (base & TextAttributes.ITALIC) codes.push(3)
  if (base & TextAttributes.UNDERLINE) codes.push(4)
  if (base & TextAttributes.BLINK) codes.push(5)
  if (base & TextAttributes.INVERSE) codes.push(7)
  if (base & TextAttributes.HIDDEN) codes.push(8)
  if (base & TextAttributes.STRIKETHROUGH) codes.push(9)
  return codes.length ? `\x1b[${codes.join(";")}m` : ""
}

function spanLinesToAnsi(lines: CapturedLine[]): string {
  const result: string[] = []
  for (const line of lines) {
    const parts: string[] = []
    for (const span of line.spans) {
      const [fr, fg, fb] = span.fg.toInts()
      const [br, bg, bb] = span.bg.toInts()
      parts.push(
        `${attrsToAnsi(span.attributes)}${rgbaToAnsi(fr!, fg!, fb!)}${bgRgbaToAnsi(br!, bg!, bb!)}${span.text}\x1b[0m`,
      )
    }
    result.push(parts.join(""))
  }
  return result.join("\n")
}

function spanLinesToPlainText(lines: CapturedLine[]): string {
  return lines.map((line) => line.spans.map((s) => s.text).join("")).join("\n")
}

export const screenshotCommand: SlashCommand = {
  name: "screenshot",
  description: "Capture current screen to file",
  aliases: ["ss"],
  argumentHint: "[filename]",
  execute: async (args: string, ctx: CommandContext) => {
    const renderer = ctx.renderer
    if (!renderer) {
      ctx.pushEvent({ type: "system_message", ephemeral: true, text: "Renderer not available." })
      return
    }

    const buffer = renderer.currentRenderBuffer
    const lines = buffer.getSpanLines()

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const baseName = args.trim() || `screenshot-${timestamp}`

    mkdirSync(SCREENSHOT_DIR, { recursive: true })

    const txtPath = join(SCREENSHOT_DIR, `${baseName}.txt`)
    const ansPath = join(SCREENSHOT_DIR, `${baseName}.ans`)

    writeFileSync(txtPath, spanLinesToPlainText(lines))
    writeFileSync(ansPath, spanLinesToAnsi(lines))

    ctx.pushEvent({
      type: "system_message",
      ephemeral: true,
      text: `Screenshot saved:\n  ${txtPath}\n  ${ansPath}`,
    })
  },
}
