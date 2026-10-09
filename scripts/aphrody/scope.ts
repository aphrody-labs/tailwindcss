// The fork publishes Tailwind CSS under the @aphrody scope. This file is the
// single source of truth for that rename.
//
// The rename only happens on the staged copies that get published
// (publish-npm.ts, publish-crates.ts): the sources keep upstream's names, so
// `import 'tailwindcss'`, `@import "tailwindcss"` and the napi loader's
// `require('@tailwindcss/oxide-<platform>')` keep working and upstream merges
// never conflict on them. Published manifests depend on each other through npm
// aliases (`"tailwindcss": "npm:@aphrody/tailwindcss@<version>"`), so a consumer
// that installs `@aphrody/tailwindcss-node` still resolves `tailwindcss`.
//
//   bun scripts/aphrody/scope.ts --check   every public workspace and crate has an @aphrody name (exit 1 otherwise)
//   bun scripts/aphrody/scope.ts --list    upstream name -> fork name

import { join, relative } from 'node:path'
import { ROOT, workspaceDirs } from './workspaces.ts'

export const SCOPE = '@aphrody'
export const REPOSITORY = 'https://github.com/aphrody-labs/tailwindcss'
export const VERSION_TAG = 'aphrody'

/** `tailwindcss` -> `@aphrody/tailwindcss`, `@tailwindcss/x` -> `@aphrody/tailwindcss-x`, others unchanged. */
export function scopedName(name: string): string {
  if (name === 'tailwindcss') return `${SCOPE}/tailwindcss`
  let m = /^@tailwindcss\/(.+)$/.exec(name)
  return m ? `${SCOPE}/tailwindcss-${m[1]}` : name
}

export function isRenamed(name: string) {
  return scopedName(name) !== name
}

/** `4.3.3` + 1 -> `4.3.3-aphrody.1` (a prerelease of the upstream version it is built from). */
export function forkVersion(base: string, n: number): string {
  return `${base.replace(/-.*$/, '')}-${VERSION_TAG}.${n}`
}

export type Workspace = { dir: string; rel: string; name: string; version: string; manifest: any }

export function publicWorkspaces(root = ROOT): Workspace[] {
  let out: Workspace[] = []
  for (let dir of workspaceDirs(root, ['!./playgrounds/*', '!./integrations'])) {
    let manifest = JSON.parse(require('node:fs').readFileSync(join(dir, 'package.json'), 'utf8'))
    if (manifest.private) continue
    out.push({
      dir,
      rel: relative(root, dir).replaceAll('\\', '/'),
      name: manifest.name,
      version: manifest.version,
      manifest,
    })
  }
  return out
}

// Rust crates: upstream names are taken on crates.io (`ignore` is BurntSushi's),
// so the staged crates are renamed and keep their library names.
export type Crate = {
  dir: string
  upstream: string
  name: string
  lib: string
  description: string
}
export const CRATES: Crate[] = [
  {
    dir: 'crates/classification-macros',
    upstream: 'classification-macros',
    name: 'aphrody-tailwindcss-classification-macros',
    lib: 'classification_macros',
    description:
      'Proc macros of the Tailwind CSS oxide scanner (Aphrody fork of tailwindlabs/tailwindcss).',
  },
  {
    dir: 'crates/ignore',
    upstream: 'ignore',
    name: 'aphrody-tailwindcss-ignore',
    lib: 'ignore',
    description:
      "The Tailwind CSS vendored copy of BurntSushi's ignore crate (Aphrody fork of tailwindlabs/tailwindcss).",
  },
  {
    dir: 'crates/oxide',
    upstream: 'tailwindcss-oxide',
    name: 'aphrody-tailwindcss-oxide',
    lib: 'tailwindcss_oxide',
    description:
      'Tailwind CSS oxide: the Rust candidate scanner behind @aphrody/tailwindcss-oxide (Aphrody fork of tailwindlabs/tailwindcss).',
  },
]

export function check(root = ROOT): string[] {
  let problems: string[] = []
  let seen = new Map<string, string>()
  let workspaces = publicWorkspaces(root)
  let names = new Set(workspaces.map((w) => w.name))
  for (let w of workspaces) {
    let scoped = scopedName(w.name)
    if (scoped === w.name) problems.push(`${w.rel}: ${w.name} has no @aphrody name`)
    if (seen.has(scoped)) problems.push(`${w.rel}: ${scoped} also used by ${seen.get(scoped)}`)
    seen.set(scoped, w.rel)
    for (let field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (let [dep, spec] of Object.entries<string>(w.manifest[field] ?? {})) {
        if (spec.startsWith('workspace:') && !names.has(dep))
          problems.push(`${w.rel}: ${field}.${dep} is a workspace package that is not published`)
      }
    }
  }
  for (let c of CRATES) {
    let toml = require('node:fs').readFileSync(join(root, c.dir, 'Cargo.toml'), 'utf8') as string
    if (!new RegExp(`^name = "${c.upstream}"`, 'm').test(toml))
      problems.push(`${c.dir}: crate is no longer ${c.upstream}`)
  }
  return problems
}

if (import.meta.main) {
  if (process.argv.includes('--list')) {
    for (let w of publicWorkspaces()) console.log(`${w.name} -> ${scopedName(w.name)} (${w.rel})`)
    for (let c of CRATES) console.log(`crate ${c.upstream} -> ${c.name} (${c.dir})`)
  } else {
    let problems = check()
    for (let p of problems) console.error(p)
    if (problems.length) process.exit(1)
    console.log('scope ok')
  }
}
