/**
 * Build the SPA once at launcher boot and hold each output in memory.
 *
 * Bun's built-in transpiler doesn't understand Solid's reactive JSX — its
 * default JSX transform emits React.createElement calls ("React is not
 * defined" at runtime). So we wire a Bun plugin that runs
 * `babel-preset-solid` with `generate: "dom"` + `moduleName: "solid-js/web"`
 * over every .tsx/.jsx in the entrypoint graph. `@opentui/solid` pulls the
 * babel toolchain in as a transitive dep, so we don't add new top-level deps.
 */

import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { readFile } from "node:fs/promises"
import type { BunPlugin } from "bun"
// @ts-expect-error — no types, re-exported through @opentui/solid's transitive deps
import { transformAsync } from "@babel/core"
// @ts-expect-error — no types
import solidPreset from "babel-preset-solid"
// @ts-expect-error — no types
import tsPreset from "@babel/preset-typescript"

const here = dirname(fileURLToPath(import.meta.url))
// src/minislack/server/ -> src/minislack/web/
const WEB_ROOT = join(here, "..", "web")

function solidBrowserPlugin(): BunPlugin {
  return {
    name: "minislack-solid-browser",
    setup(build) {
      build.onLoad({ filter: /\.(j|t)sx$/ }, async (args) => {
        const path = args.path.split("?")[0]!.split("#")[0]!
        const code = await Bun.file(path).text()
        const result = await transformAsync(code, {
          filename: path,
          configFile: false,
          babelrc: false,
          presets: [
            [solidPreset, { moduleName: "solid-js/web", generate: "dom" }],
            [tsPreset],
          ],
        })
        return {
          contents: (result?.code ?? "") as string,
          loader: "js",
        }
      })
    },
  }
}

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
    plugins: [solidBrowserPlugin()],
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
