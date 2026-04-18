/**
 * Build the SPA once at launcher boot and hold each output in memory.
 *
 * We use Bun.build with target="browser". The preload in bunfig.toml
 * (@opentui/solid/preload) is a Bun runtime preload — it does NOT affect
 * Bun.build's transpilation pipeline, so the browser bundle gets Solid's
 * default JSX transform via the per-file @jsxImportSource pragma.
 */

import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { readFile } from "node:fs/promises"

const here = dirname(fileURLToPath(import.meta.url))
// src/minislack/server/ -> src/minislack/web/
const WEB_ROOT = join(here, "..", "web")

export interface WebBundle {
  get(path: string): { body: Uint8Array; contentType: string } | undefined
}

/** Produce an in-memory asset map keyed by absolute request path. */
export async function buildWebBundle(): Promise<WebBundle> {
  const entry = join(WEB_ROOT, "main.tsx")

  const result = await Bun.build({
    entrypoints: [entry],
    target: "browser",
    format: "esm",
    minify: false,
    sourcemap: "inline",
    naming: {
      entry: "main.js",
      chunk: "[name]-[hash].js",
      asset: "[name].[ext]",
    },
  })

  if (!result.success) {
    const details = result.logs.map((l) => l.message).join("\n")
    throw new Error(`minislack web bundle failed:\n${details}`)
  }

  const assets = new Map<string, { body: Uint8Array; contentType: string }>()

  for (const out of result.outputs) {
    const body = new Uint8Array(await out.arrayBuffer())
    const name = out.path.split("/").pop() ?? out.path
    assets.set(`/${name}`, { body, contentType: contentTypeFor(name) })
  }

  // Serve the static shell and stylesheet directly from disk (they don't
  // pass through Bun.build; faster and simpler).
  const indexHtml = await readFile(join(WEB_ROOT, "index.html"))
  assets.set("/", { body: new Uint8Array(indexHtml), contentType: "text/html; charset=utf-8" })
  const appCss = await readFile(join(WEB_ROOT, "styles", "app.css"))
  assets.set("/app.css", { body: new Uint8Array(appCss), contentType: "text/css; charset=utf-8" })

  return {
    get(path) {
      return assets.get(path)
    },
  }
}

function contentTypeFor(name: string): string {
  if (name.endsWith(".js")) return "application/javascript; charset=utf-8"
  if (name.endsWith(".css")) return "text/css; charset=utf-8"
  if (name.endsWith(".map")) return "application/json; charset=utf-8"
  if (name.endsWith(".html")) return "text/html; charset=utf-8"
  if (name.endsWith(".json")) return "application/json; charset=utf-8"
  return "application/octet-stream"
}
