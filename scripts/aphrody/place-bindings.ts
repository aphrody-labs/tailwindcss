// Copies downloaded release artifacts (<dir>/bindings-<platform>/*.node) into
// crates/node/npm/<platform>/, where publish-npm.ts expects them.
//
//   bun scripts/aphrody/place-bindings.ts <artifacts dir>

import { Glob } from 'bun'
import { copyFileSync, existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { ROOT } from './workspaces.ts'

let dir = resolve(process.argv[2] ?? join(ROOT, 'crates', 'node', 'artifacts'))
let placed = 0
for (let file of new Glob('bindings-*/*.node').scanSync({ cwd: dir })) {
  let rel = file.replaceAll('\\', '/')
  let platform = rel.split('/')[0].slice('bindings-'.length)
  let target = join(ROOT, 'crates', 'node', 'npm', platform)
  if (!existsSync(target)) throw new Error(`no platform package for ${platform}`)
  copyFileSync(join(dir, file), join(target, basename(file)))
  console.log(`${rel} -> crates/node/npm/${platform}/`)
  placed++
}
if (!placed) throw new Error(`no bindings found in ${dir}`)
