/**
 * Platform-specific clipboard read/write support.
 *
 * Write: getClipboardCmd() + copyToClipboard()
 * Read:  getClipboardReadCmd() + readClipboard()
 *
 * Uses native clipboard tools:
 *   macOS  → pbcopy / pbpaste
 *   Linux  → xclip -selection clipboard (or wl-paste for Wayland)
 *   WSL    → clip.exe / powershell Get-Clipboard
 */

export function getClipboardCmd(): { cmd: string; args: string[] } | null {
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

/** Returns the platform-specific command for reading from the system clipboard. */
export function getClipboardReadCmd(): { cmd: string; args: string[] } | null {
  const platform = process.platform
  if (platform === "darwin") return { cmd: "pbpaste", args: [] }
  if (platform === "linux") {
    if (process.env.WSL_DISTRO_NAME) {
      return { cmd: "powershell.exe", args: ["-Command", "Get-Clipboard"] }
    }
    if (process.env.WAYLAND_DISPLAY) {
      return { cmd: "wl-paste", args: ["--no-newline"] }
    }
    return { cmd: "xclip", args: ["-selection", "clipboard", "-o"] }
  }
  if (platform === "win32") {
    return { cmd: "powershell.exe", args: ["-Command", "Get-Clipboard"] }
  }
  return null
}

export async function copyToClipboard(text: string): Promise<void> {
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

/** Read text from the system clipboard. */
export async function readClipboard(): Promise<string> {
  const clip = getClipboardReadCmd()
  if (!clip) throw new Error("Unsupported platform for clipboard read")

  const proc = Bun.spawn([clip.cmd, ...clip.args], {
    stdout: "pipe",
    stderr: "pipe",
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(
      `Clipboard read command exited with code ${exitCode}: ${stderr.trim()}`,
    )
  }

  const text = await new Response(proc.stdout).text()
  return text
}
