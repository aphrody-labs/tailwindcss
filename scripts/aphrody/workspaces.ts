// Bun workspace helpers for the Aphrody fork of Tailwind CSS.
//
// Upstream drives the monorepo with pnpm (pnpm-workspace.yaml, pnpm-lock.yaml,
// `pnpm -r exec`). The fork uses Bun only: the workspace list, catalog, patches
// and trusted build scripts live in the root package.json, the lockfile is
// bun.lock. This module is the single owner of that conversion.
//
//   bun scripts/aphrody/workspaces.ts [--filter=!./playgrounds/* ...]   absolute workspace dirs, one per line
//   bun scripts/aphrody/workspaces.ts --from-pnpm <pnpm-workspace.yaml>  rewrite package.json from upstream's yaml

import { Glob } from 'bun'
import { dirname, join, relative, resolve } from 'node:path'

export const ROOT = resolve(import.meta.dir, '..', '..')

type PnpmWorkspace = {
  packages?: string[]
  catalog?: Record<string, string>
  catalogs?: Record<string, Record<string, string>>
  patchedDependencies?: Record<string, string>
  onlyBuiltDependencies?: string[]
  allowBuilds?: Record<string, boolean>
}

function readJson(path: string): any {
  return JSON.parse(require('node:fs').readFileSync(path, 'utf8'))
}

/** Workspace patterns of the root package.json (array or `{ packages }` form). */
export function workspacePatterns(root = ROOT): string[] {
  let ws = readJson(join(root, 'package.json')).workspaces
  return Array.isArray(ws) ? ws : (ws?.packages ?? [])
}

/** Absolute directories of every workspace package, root excluded, sorted. */
export function workspaceDirs(root = ROOT, filters: string[] = []): string[] {
  let excludes = filters
    .filter((f) => f.startsWith('!'))
    .map((f) => new Glob(f.slice(1).replace(/^\.\//, '')))
  let dirs = new Set<string>()
  for (let pattern of workspacePatterns(root)) {
    let glob = new Glob(`${pattern.replace(/\/$/, '')}/package.json`)
    for (let file of glob.scanSync({ cwd: root, onlyFiles: true })) {
      let rel = dirname(file).replaceAll('\\', '/')
      if (rel.includes('node_modules')) continue
      if (excludes.some((g) => g.match(rel))) continue
      dirs.add(resolve(root, rel))
    }
  }
  return [...dirs].sort()
}

/** The package.json fields that replace upstream's pnpm-workspace.yaml. */
export function fromPnpm(yaml: PnpmWorkspace) {
  let trusted = new Set<string>(yaml.onlyBuiltDependencies ?? [])
  for (let [name, allowed] of Object.entries(yaml.allowBuilds ?? {})) {
    if (allowed) trusted.add(name)
    else trusted.delete(name)
  }
  return {
    workspaces: {
      packages: yaml.packages ?? [],
      ...(yaml.catalog ? { catalog: yaml.catalog } : {}),
      ...(yaml.catalogs ? { catalogs: yaml.catalogs } : {}),
    },
    patchedDependencies: yaml.patchedDependencies ?? {},
    trustedDependencies: [...trusted].sort(),
  }
}

/** Root package.json text with the pnpm-workspace.yaml fields folded in. */
export function applyPnpm(pkgText: string, yamlText: string): string {
  let pkg = JSON.parse(pkgText)
  let fields = fromPnpm(Bun.YAML.parse(yamlText) as PnpmWorkspace)
  for (let [key, value] of Object.entries(fields)) {
    if (key === 'patchedDependencies' && Object.keys(value).length === 0) delete pkg[key]
    else pkg[key] = value
  }
  return JSON.stringify(pkg, null, 2) + '\n'
}

if (import.meta.main) {
  let args = process.argv.slice(2)
  let from = args.indexOf('--from-pnpm')
  if (from !== -1) {
    let yamlPath = resolve(args[from + 1] ?? join(ROOT, 'pnpm-workspace.yaml'))
    let pkgPath = join(ROOT, 'package.json')
    await Bun.write(
      pkgPath,
      applyPnpm(await Bun.file(pkgPath).text(), await Bun.file(yamlPath).text()),
    )
    console.log(`package.json updated from ${relative(ROOT, yamlPath)}`)
  } else {
    let filters = args.flatMap((a) =>
      a.startsWith('--filter=') ? [a.slice(9).replace(/^'|'$/g, '')] : [],
    )
    for (let dir of workspaceDirs(ROOT, filters)) console.log(dir)
  }
}
