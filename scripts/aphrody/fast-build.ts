// Fast parallel build pipeline using Bun.build for Tailwind CSS monorepo packages.
// Compiles packages/tailwindcss, @tailwindcss-postcss, @tailwindcss-node, @tailwindcss-cli, @tailwindcss-browser.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dir, '..', '..')
const startTime = performance.now()

console.log('⚡ Starting Bun fast-build pipeline...')

async function buildTailwindCss() {
  const pkgDir = join(ROOT, 'packages', 'tailwindcss')
  const outdir = join(pkgDir, 'dist')
  mkdirSync(outdir, { recursive: true })

  const [esmResult, cjsResult] = await Promise.all([
    Bun.build({
      entrypoints: [
        join(pkgDir, 'src', 'index.ts'),
        join(pkgDir, 'src', 'plugin.ts'),
        join(pkgDir, 'src', 'compat', 'colors.ts'),
        join(pkgDir, 'src', 'compat', 'default-theme.ts'),
        join(pkgDir, 'src', 'compat', 'flatten-color-palette.ts'),
      ],
      outdir,
      target: 'node',
      format: 'esm',
      naming: '[name].mjs',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
      define: {
        'process.env.FEATURES_ENV': JSON.stringify(process.env.FEATURES_ENV ?? 'insiders'),
      },
    }),
    Bun.build({
      entrypoints: [
        join(pkgDir, 'src', 'index.cts'),
        join(pkgDir, 'src', 'plugin.cts'),
        join(pkgDir, 'src', 'compat', 'colors.cts'),
        join(pkgDir, 'src', 'compat', 'default-theme.cts'),
        join(pkgDir, 'src', 'compat', 'flatten-color-palette.cts'),
      ],
      outdir,
      target: 'node',
      format: 'cjs',
      naming: '[name].js',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
      define: {
        'process.env.FEATURES_ENV': JSON.stringify(process.env.FEATURES_ENV ?? 'insiders'),
      },
    }),
  ])

  if (!esmResult.success) {
    console.error('Failed to build tailwindcss (ESM):', esmResult.logs)
    throw new Error('tailwindcss ESM build failed')
  }
  if (!cjsResult.success) {
    console.error('Failed to build tailwindcss (CJS):', cjsResult.logs)
    throw new Error('tailwindcss CJS build failed')
  }

  // Provide lib.mjs / lib.js aliases matching publishConfig and require exports
  if (existsSync(join(outdir, 'index.mjs'))) {
    copyFileSync(join(outdir, 'index.mjs'), join(outdir, 'lib.mjs'))
  }
  if (existsSync(join(outdir, 'index.mjs.map'))) {
    copyFileSync(join(outdir, 'index.mjs.map'), join(outdir, 'lib.mjs.map'))
  }
  if (existsSync(join(outdir, 'index.js'))) {
    copyFileSync(join(outdir, 'index.js'), join(outdir, 'lib.js'))
  }
  if (existsSync(join(outdir, 'index.js.map'))) {
    copyFileSync(join(outdir, 'index.js.map'), join(outdir, 'lib.js.map'))
  }

  return 'tailwindcss'
}

async function buildPostcss() {
  const pkgDir = join(ROOT, 'packages', '@tailwindcss-postcss')
  const outdir = join(pkgDir, 'dist')
  mkdirSync(outdir, { recursive: true })

  const [esmResult, cjsResult] = await Promise.all([
    Bun.build({
      entrypoints: [join(pkgDir, 'src', 'index.ts')],
      outdir,
      target: 'node',
      format: 'esm',
      naming: 'index.mjs',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
    }),
    Bun.build({
      entrypoints: [join(pkgDir, 'src', 'index.cts')],
      outdir,
      target: 'node',
      format: 'cjs',
      naming: 'index.js',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
    }),
  ])

  if (!esmResult.success) {
    console.error('Failed to build @tailwindcss/postcss (ESM):', esmResult.logs)
    throw new Error('@tailwindcss/postcss ESM build failed')
  }
  if (!cjsResult.success) {
    console.error('Failed to build @tailwindcss/postcss (CJS):', cjsResult.logs)
    throw new Error('@tailwindcss/postcss CJS build failed')
  }

  return '@tailwindcss/postcss'
}

async function buildNode() {
  const pkgDir = join(ROOT, 'packages', '@tailwindcss-node')
  const outdir = join(pkgDir, 'dist')
  mkdirSync(outdir, { recursive: true })

  const [esmResult, cjsResult, esmCacheResult, reqCacheResult] = await Promise.all([
    Bun.build({
      entrypoints: [join(pkgDir, 'src', 'index.ts')],
      outdir,
      target: 'node',
      format: 'esm',
      naming: 'index.mjs',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
    Bun.build({
      entrypoints: [join(pkgDir, 'src', 'index.cts')],
      outdir,
      target: 'node',
      format: 'cjs',
      naming: 'index.js',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
    Bun.build({
      entrypoints: [join(pkgDir, 'src', 'esm-cache.loader.mts')],
      outdir,
      target: 'node',
      format: 'esm',
      naming: 'esm-cache.loader.mjs',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
    Bun.build({
      entrypoints: [join(pkgDir, 'src', 'require-cache.cts')],
      outdir,
      target: 'node',
      format: 'cjs',
      naming: 'require-cache.js',
      packages: 'external',
      minify: true,
      sourcemap: 'external',
      define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
      },
    }),
  ])

  if (!esmResult.success) throw new Error('@tailwindcss/node ESM build failed')
  if (!cjsResult.success) throw new Error('@tailwindcss/node CJS build failed')
  if (!esmCacheResult.success) throw new Error('@tailwindcss/node esm-cache loader build failed')
  if (!reqCacheResult.success) throw new Error('@tailwindcss/node require-cache build failed')

  return '@tailwindcss/node'
}

async function buildCli() {
  const pkgDir = join(ROOT, 'packages', '@tailwindcss-cli')
  const outdir = join(pkgDir, 'dist')
  mkdirSync(outdir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [join(pkgDir, 'src', 'index.ts')],
    outdir,
    target: 'node',
    format: 'esm',
    naming: 'index.mjs',
    packages: 'external',
    minify: true,
    sourcemap: 'external',
  })

  if (!result.success) {
    console.error('Failed to build @tailwindcss/cli:', result.logs)
    throw new Error('@tailwindcss/cli build failed')
  }

  return '@tailwindcss/cli'
}

async function buildBrowser() {
  const pkgDir = join(ROOT, 'packages', '@tailwindcss-browser')
  const outdir = join(pkgDir, 'dist')
  mkdirSync(outdir, { recursive: true })

  const result = await Bun.build({
    entrypoints: [join(pkgDir, 'src', 'index.ts')],
    outdir,
    format: 'iife',
    naming: 'index.global.js',
    minify: true,
    sourcemap: 'external',
    loader: {
      '.css': 'text',
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.FEATURES_ENV': JSON.stringify('stable'),
    },
  })

  if (!result.success) {
    console.error('Failed to build @tailwindcss/browser:', result.logs)
    throw new Error('@tailwindcss/browser build failed')
  }

  return '@tailwindcss/browser'
}

// Run all package builds concurrently in parallel
const built = await Promise.all([
  buildTailwindCss(),
  buildPostcss(),
  buildNode(),
  buildCli(),
  buildBrowser(),
])

const durationMs = (performance.now() - startTime).toFixed(1)
console.log(`✅ Fast build completed in ${durationMs}ms:`)
for (const name of built) {
  console.log(`   - ${name}`)
}
