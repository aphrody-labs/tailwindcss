// Mechanical pnpm/npm/node/vitest -> Bun rewrite of the workspace manifests.
//
// `rewrite()` is idempotent and is the single source of truth for what the fork
// changes in upstream package.json scripts. The upstream sync applies it to the
// merge base and the upstream side of a conflicted manifest before a three-way
// merge, so upstream edits next to these scripts merge cleanly.
//
//   bun scripts/aphrody/bunify.ts --check   list manifests that still call pnpm/npm/node/vitest (exit 1 if any)
//   bun scripts/aphrody/bunify.ts --write   rewrite them in place

import { join, relative } from 'node:path'
import { ROOT, workspaceDirs } from './workspaces.ts'

export const BUN_VERSION = '1.4.3-aphrody.2'

// Whole-script replacements, matched exactly (root package.json).
const SCRIPTS: Record<string, string> = {
  'cargo test && vitest run --hideSkippedTests': 'cargo test && bun test',
  'vitest --root=./integrations': 'bun test --config=integrations/bunfig.toml integrations',
  'vitest --hideSkippedTests': 'bun test --watch',
}

// Token rewrites inside any script.
const RULES: [RegExp, string][] = [
  [/\b(?:pnpm|npm) run /g, 'bun run '],
  [/\bpnpm --filter[= ]([^ ]+) run /g, 'bun run --filter=$1 '],
  [/(^|&& |; )node (?:\.\/)?((?:scripts|\.)\/)/g, '$1bun ./$2'],
  [/(^|&& |; )npx /g, '$1bun x '],
  // A glob that matches nothing fails in the Bun shell (`bun run` on Windows); pnpm's sh passed it on as is.
  [/(^| )(--filter=[^ '"]*\*[^ '"]*)/g, "$1'$2'"],
]

export function rewriteScript(script: string): string {
  if (SCRIPTS[script]) return SCRIPTS[script]
  let out = RULES.reduce((s, [re, to]) => s.replace(re, to), script)
  return out.replace(/bun \.\/\.\//g, 'bun ./')
}

export function isManifest(path: string) {
  return /(?:^|\/)package\.json$/.test(path.replaceAll('\\', '/')) && !path.includes('node_modules')
}

/** Rewrites the `scripts` (and the root `packageManager`) of a manifest, keeping its formatting. */
export function rewrite(path: string, text: string): string {
  if (!isManifest(path)) return text
  let pkg: any
  try {
    pkg = JSON.parse(text)
  } catch {
    return text
  }
  let out = text
  for (let [name, script] of Object.entries<string>(pkg.scripts ?? {})) {
    let next = rewriteScript(script)
    if (next === script) continue
    out = out.replace(
      `${JSON.stringify(name)}: ${JSON.stringify(script)}`,
      () => `${JSON.stringify(name)}: ${JSON.stringify(next)}`,
    )
  }
  if (typeof pkg.packageManager === 'string' && !pkg.packageManager.startsWith('bun@')) {
    out = out.replace(
      `"packageManager": ${JSON.stringify(pkg.packageManager)}`,
      `"packageManager": "bun@${BUN_VERSION}"`,
    )
  }
  return out
}

export function manifests(root = ROOT): string[] {
  return [join(root, 'package.json'), ...workspaceDirs(root).map((d) => join(d, 'package.json'))]
}

export async function apply(root: string, write: boolean): Promise<string[]> {
  let changed: string[] = []
  for (let file of manifests(root)) {
    let rel = relative(root, file).replaceAll('\\', '/')
    let before = await Bun.file(file).text()
    let after = rewrite(rel, before)
    if (after === before) continue
    changed.push(rel)
    if (write) await Bun.write(file, after)
  }
  return changed
}

if (import.meta.main) {
  let write = process.argv.includes('--write')
  let changed = await apply(ROOT, write)
  for (let f of changed) console.log(`${write ? 'rewrote' : 'not bunified'} ${f}`)
  if (!write && changed.length) {
    console.error(`${changed.length} manifest(s) still call pnpm/npm/node/vitest; run with --write`)
    process.exit(1)
  }
}
