import { describe, expect, test } from 'bun:test'
import { rewrite, rewriteScript } from './bunify.ts'
import { crateVersion, stagedToml } from './publish-crates.ts'
import { patchLoader, publishOrder, stagedManifest } from './publish-npm.ts'
import {
  check,
  CRATES,
  forkVersion,
  publicWorkspaces,
  scopedName,
  type Workspace,
} from './scope.ts'
import { forkView } from './sync-upstream.ts'
import { applyPnpm, fromPnpm, ROOT, workspaceDirs } from './workspaces.ts'

describe('workspaces', () => {
  test('fromPnpm folds the yaml fields into package.json shape', () => {
    expect(
      fromPnpm({
        packages: ['packages/*'],
        catalog: { vite: '^7' },
        patchedDependencies: { 'a@1': 'patches/a.patch' },
        onlyBuiltDependencies: ['esbuild', 'sharp'],
        allowBuilds: { sharp: false, bun: true },
      }),
    ).toEqual({
      workspaces: { packages: ['packages/*'], catalog: { vite: '^7' } },
      patchedDependencies: { 'a@1': 'patches/a.patch' },
      trustedDependencies: ['bun', 'esbuild'],
    })
  })

  test('applyPnpm is idempotent', () => {
    let yaml = 'packages:\n  - packages/*\ncatalog:\n  vite: ^7\n'
    let once = applyPnpm('{"name":"root"}', yaml)
    expect(applyPnpm(once, yaml)).toBe(once)
    expect(JSON.parse(once).patchedDependencies).toBeUndefined()
  })

  test('workspaceDirs honours ! filters', () => {
    let all = workspaceDirs(ROOT)
    let filtered = workspaceDirs(ROOT, ['!./playgrounds/*'])
    expect(all.some((d) => d.replaceAll('\\', '/').includes('/playgrounds/'))).toBe(true)
    expect(filtered.some((d) => d.replaceAll('\\', '/').includes('/playgrounds/'))).toBe(false)
  })
})

describe('bunify', () => {
  test.each([
    ['pnpm run build', 'bun run build'],
    ['npm run lint && pnpm run test', 'bun run lint && bun run test'],
    ['node ./scripts/move-artifacts.mjs', 'bun ./scripts/move-artifacts.mjs'],
    ['node scripts/x.mjs', 'bun ./scripts/x.mjs'],
    ['npx prettier .', 'bun x prettier .'],
    ['cargo test && vitest run --hideSkippedTests', 'cargo test && bun test'],
    ['tsup-node', 'tsup-node'],
  ])('%s', (input, output) => {
    expect(rewriteScript(input)).toBe(output)
    expect(rewriteScript(output)).toBe(output)
  })

  test('rewrite keeps formatting and pins packageManager', () => {
    let text =
      '{\n  "scripts": {\n    "build": "pnpm run build:x"\n  },\n  "packageManager": "pnpm@10.0.0"\n}\n'
    expect(rewrite('package.json', text)).toBe(
      '{\n  "scripts": {\n    "build": "bun run build:x"\n  },\n  "packageManager": "bun@1.4.3-aphrody.2"\n}\n',
    )
    expect(rewrite('README.md', text)).toBe(text)
  })

  test('sync view of upstream root manifest matches the fork shape', () => {
    let pkg = '{\n  "name": "root",\n  "scripts": {\n    "build": "pnpm run x"\n  }\n}\n'
    let view = JSON.parse(forkView('package.json', pkg, 'packages:\n  - packages/*\n'))
    expect(view.scripts.build).toBe('bun run x')
    expect(view.workspaces.packages).toEqual(['packages/*'])
  })
})

describe('scope', () => {
  test('names', () => {
    expect(scopedName('tailwindcss')).toBe('@aphrody/tailwindcss')
    expect(scopedName('@tailwindcss/oxide-win32-x64-msvc')).toBe(
      '@aphrody/tailwindcss-oxide-win32-x64-msvc',
    )
    expect(scopedName('vite')).toBe('vite')
    expect(forkVersion('4.3.3', 2)).toBe('4.3.3-aphrody.2')
    expect(forkVersion('4.3.3-aphrody.1', 2)).toBe('4.3.3-aphrody.2')
  })

  test('the checkout passes the scope check', () => {
    expect(check(ROOT)).toEqual([])
  })
})

describe('publish-npm', () => {
  let workspaces = publicWorkspaces()
  let names = new Set(workspaces.map((w) => w.name))
  let byName = (n: string) => workspaces.find((w) => w.name === n) as Workspace

  test('@tailwindcss/node depends on tailwindcss through an alias', () => {
    let pkg = stagedManifest(byName('@tailwindcss/node'), '4.3.3-aphrody.1', names, {
      'enhanced-resolve': '^5',
      lightningcss: '1.30.0',
    })
    expect(pkg.name).toBe('@aphrody/tailwindcss-node')
    expect(pkg.dependencies.tailwindcss).toBe('npm:@aphrody/tailwindcss@4.3.3-aphrody.1')
    expect(pkg.dependencies.lightningcss).toBe('1.30.0')
    expect(pkg.exports['.'].import).toBe('./dist/index.mjs')
    expect(pkg.publishConfig).toEqual({ access: 'public' })
    expect(pkg.scripts).toBeUndefined()
    expect(pkg.devDependencies).toBeUndefined()
  })

  test('oxide points its optional platform packages at the scoped names', () => {
    let pkg = stagedManifest(byName('@tailwindcss/oxide'), '4.3.3-aphrody.1', names, {})
    expect(pkg.optionalDependencies['@tailwindcss/oxide-win32-x64-msvc']).toBe(
      'npm:@aphrody/tailwindcss-oxide-win32-x64-msvc@4.3.3-aphrody.1',
    )
  })

  test('patchLoader rewrites the pinned binding version', () => {
    let src = "if (v !== '4.3.3' && x) throw new Error(`expected 4.3.3 but got ${v}`)"
    expect(patchLoader(src, '4.3.3', '4.3.3-aphrody.1')).toBe(
      "if (v !== '4.3.3-aphrody.1' && x) throw new Error(`expected 4.3.3-aphrody.1 but got ${v}`)",
    )
  })

  test('platform packages go first, tailwindcss before its dependents', () => {
    let order = publishOrder(workspaces).map((w) => w.name)
    expect(order.indexOf('@tailwindcss/oxide-win32-x64-msvc')).toBeLessThan(
      order.indexOf('@tailwindcss/oxide'),
    )
    expect(order.indexOf('tailwindcss')).toBeLessThan(order.indexOf('@tailwindcss/node'))
    expect(order.indexOf('@tailwindcss/node')).toBeLessThan(order.indexOf('@tailwindcss/vite'))
  })
})

describe('publish-crates', () => {
  let versions = { 'classification-macros': '1.0.0', ignore: '1.0.0', 'tailwindcss-oxide': '1.0.0' }

  test('oxide depends on the renamed crates and keeps its lib names', async () => {
    let oxide = CRATES.find((c) => c.upstream === 'tailwindcss-oxide')!
    let toml = await Bun.file(`${ROOT}/${oxide.dir}/Cargo.toml`).text()
    let out = stagedToml(oxide, toml, versions)
    expect(out).toContain('name = "aphrody-tailwindcss-oxide"')
    expect(out).toContain('version = "1.0.0"')
    expect(out).toContain('ignore = { package = "aphrody-tailwindcss-ignore", version = "=1.0.0" }')
    expect(out).toContain(
      'classification-macros = { package = "aphrody-tailwindcss-classification-macros", version = "=1.0.0" }',
    )
    expect(out).toContain('name = "tailwindcss_oxide"')
    expect(out).toContain('license = "MIT"')
    expect(crateVersion(out)).toBe('1.0.0')
  })

  test('ignore keeps its multi-line description replaced and its license', async () => {
    let ignore = CRATES.find((c) => c.upstream === 'ignore')!
    let toml = await Bun.file(`${ROOT}/${ignore.dir}/Cargo.toml`).text()
    let out = stagedToml(ignore, toml, versions)
    expect(out).toContain('name = "aphrody-tailwindcss-ignore"')
    expect(out).toContain('license = "Unlicense OR MIT"')
    expect(out).not.toContain('A fast library for efficiently')
    expect(out.match(/^\[lib\]/gm)).toHaveLength(1)
  })
})
