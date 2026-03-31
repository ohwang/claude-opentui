/**
 * Platform-specific clipboard write support.
 *
 * Uses native clipboard tools:
 *   macOS  → pbcopy
 *   Linux  → xclip -selection clipboard  (fallback: xsel --clipboard)
 *   WSL    → clip.exe
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
