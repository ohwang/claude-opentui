/**
 * ANSI Escape Code → StyledText Converter
 *
 * Parses ANSI SGR escape sequences from command output and converts
 * them to OpenTUI StyledText chunks for native rendering.
 *
 * Supports: basic colors (30-37, 90-97), 256-color (38;5;N),
 * bold, dim, italic, underline, reverse, strikethrough, and reset.
 */

import { StyledText, type TextChunk } from "@opentui/core"
import { RGBA } from "@opentui/core"
import { TextAttributes } from "@opentui/core"

// SGR escape sequence: ESC[ ... m
const SGR_REGEX = /\x1b\[([0-9;]*)m/g

// Standard 4-bit ANSI colors (indices 0-7)
// Matched to Kitty Snazzy theme palette for native-looking rendering
const ANSI_COLORS: [number, number, number][] = [
  [0x2e, 0x30, 0x3e], // 0 black    #2e303e
  [0xff, 0x5c, 0x57], // 1 red      #FF5C57
  [0x5a, 0xf7, 0x8e], // 2 green    #5AF78E
  [0xf3, 0xf9, 0x9d], // 3 yellow   #F3F99D
  [0x57, 0xc7, 0xff], // 4 blue     #57C7FF
  [0xff, 0x6a, 0xc1], // 5 magenta  #FF6AC1
  [0x9a, 0xed, 0xfe], // 6 cyan     #9AEDFE
  [0xf1, 0xf1, 0xf0], // 7 white    #F1F1F0
]

// Bright 4-bit ANSI colors (indices 8-15)
const ANSI_BRIGHT_COLORS: [number, number, number][] = [
  [0x78, 0x78, 0x7e], // 8  bright black    #78787e
  [0xff, 0x7b, 0x76], // 9  bright red      #FF7B76
  [0x6f, 0xf9, 0xa0], // 10 bright green    #6FF9A0
  [0xf5, 0xfb, 0xaf], // 11 bright yellow   #F5FBAF
  [0x6f, 0xd0, 0xff], // 12 bright blue     #6fd0ff
  [0xff, 0x82, 0xcd], // 13 bright magenta  #FF82CD
  [0xac, 0xf1, 0xfe], // 14 bright cyan     #acf1fe
  [0xef, 0xf0, 0xeb], // 15 bright white    #EFF0EB
]

/** Convert a 256-color index to RGB. */
function ansi256ToRgb(index: number): [number, number, number] {
  if (index < 8) return ANSI_COLORS[index]!
  if (index < 16) return ANSI_BRIGHT_COLORS[index - 8]!

  // 6x6x6 color cube (indices 16-231)
  if (index < 232) {
    const n = index - 16
    const r = Math.floor(n / 36)
    const g = Math.floor((n % 36) / 6)
    const b = n % 6
    return [
      r ? r * 40 + 55 : 0,
      g ? g * 40 + 55 : 0,
      b ? b * 40 + 55 : 0,
    ]
  }

  // Grayscale (indices 232-255)
  const v = (index - 232) * 10 + 8
  return [v, v, v]
}

interface AnsiState {
  fg: RGBA | undefined
  bg: RGBA | undefined
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  reverse: boolean
  strikethrough: boolean
}

function createDefaultState(): AnsiState {
  return {
    fg: undefined,
    bg: undefined,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    reverse: false,
    strikethrough: false,
  }
}

function applyParams(state: AnsiState, params: number[]): void {
  let i = 0
  while (i < params.length) {
    const p = params[i]!

    if (p === 0) {
      // Reset all
      Object.assign(state, createDefaultState())
    } else if (p === 1) {
      state.bold = true
    } else if (p === 2) {
      state.dim = true
    } else if (p === 3) {
      state.italic = true
    } else if (p === 4) {
      state.underline = true
    } else if (p === 7) {
      state.reverse = true
    } else if (p === 9) {
      state.strikethrough = true
    } else if (p === 22) {
      state.bold = false
      state.dim = false
    } else if (p === 23) {
      state.italic = false
    } else if (p === 24) {
      state.underline = false
    } else if (p === 27) {
      state.reverse = false
    } else if (p === 29) {
      state.strikethrough = false
    } else if (p >= 30 && p <= 37) {
      // Standard foreground
      const rgb = ANSI_COLORS[p - 30]!
      state.fg = RGBA.fromInts(rgb[0], rgb[1], rgb[2])
    } else if (p === 38) {
      // Extended foreground
      if (params[i + 1] === 5 && params[i + 2] !== undefined) {
        // 256-color: ESC[38;5;Nm
        const rgb = ansi256ToRgb(params[i + 2]!)
        state.fg = RGBA.fromInts(rgb[0], rgb[1], rgb[2])
        i += 2
      } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
        // True color: ESC[38;2;R;G;Bm
        state.fg = RGBA.fromInts(params[i + 2]!, params[i + 3]!, params[i + 4]!)
        i += 4
      }
    } else if (p === 39) {
      state.fg = undefined
    } else if (p >= 40 && p <= 47) {
      // Standard background
      const rgb = ANSI_COLORS[p - 40]!
      state.bg = RGBA.fromInts(rgb[0], rgb[1], rgb[2])
    } else if (p === 48) {
      // Extended background
      if (params[i + 1] === 5 && params[i + 2] !== undefined) {
        const rgb = ansi256ToRgb(params[i + 2]!)
        state.bg = RGBA.fromInts(rgb[0], rgb[1], rgb[2])
        i += 2
      } else if (params[i + 1] === 2 && params[i + 4] !== undefined) {
        state.bg = RGBA.fromInts(params[i + 2]!, params[i + 3]!, params[i + 4]!)
        i += 4
      }
    } else if (p === 49) {
      state.bg = undefined
    } else if (p >= 90 && p <= 97) {
      // Bright foreground
      const rgb = ANSI_BRIGHT_COLORS[p - 90]!
      state.fg = RGBA.fromInts(rgb[0], rgb[1], rgb[2])
    } else if (p >= 100 && p <= 107) {
      // Bright background
      const rgb = ANSI_BRIGHT_COLORS[p - 100]!
      state.bg = RGBA.fromInts(rgb[0], rgb[1], rgb[2])
    }

    i++
  }
}

function stateToAttributes(state: AnsiState): number {
  let attrs = 0
  if (state.bold) attrs |= TextAttributes.BOLD
  if (state.dim) attrs |= TextAttributes.DIM
  if (state.italic) attrs |= TextAttributes.ITALIC
  if (state.underline) attrs |= TextAttributes.UNDERLINE
  if (state.reverse) attrs |= TextAttributes.INVERSE
  if (state.strikethrough) attrs |= TextAttributes.STRIKETHROUGH
  return attrs
}

/**
 * Parse ANSI-escaped text and return a StyledText for OpenTUI rendering.
 */
export function ansiToStyledText(input: string): StyledText {
  const chunks: TextChunk[] = []
  const state = createDefaultState()

  let lastIndex = 0
  SGR_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = SGR_REGEX.exec(input)) !== null) {
    // Emit text before this escape sequence
    const text = input.slice(lastIndex, match.index)
    if (text) {
      const attrs = stateToAttributes(state)
      const chunk: TextChunk = {
        __isChunk: true,
        text,
        ...(state.fg && { fg: state.fg }),
        ...(state.bg && { bg: state.bg }),
        ...(attrs !== 0 && { attributes: attrs }),
      }
      chunks.push(chunk)
    }

    // Parse and apply SGR parameters
    const paramStr = match[1] ?? ""
    const params = paramStr === "" ? [0] : paramStr.split(";").map(Number)
    applyParams(state, params)

    lastIndex = match.index + match[0].length
  }

  // Emit remaining text after last escape sequence
  const remaining = input.slice(lastIndex)
  if (remaining) {
    const attrs = stateToAttributes(state)
    const chunk: TextChunk = {
      __isChunk: true,
      text: remaining,
      ...(state.fg && { fg: state.fg }),
      ...(state.bg && { bg: state.bg }),
      ...(attrs !== 0 && { attributes: attrs }),
    }
    chunks.push(chunk)
  }

  // If no ANSI codes found, return a simple unstyled text
  if (chunks.length === 0 && input) {
    chunks.push({ __isChunk: true, text: input })
  }

  return new StyledText(chunks)
}
