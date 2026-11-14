import { expect, test } from 'bun:test'
import { setImmediate } from 'node:timers/promises'
import { compile } from './index'

test.todo('compiler releases loader callbacks after compilation', async () => {
  let plugin = () => {}

  async function createCompiler() {
    let loadStylesheet = async () => ({
      path: 'utilities.css',
      base: '.',
      content: '@tailwind utilities;',
    })
    let loadModule = async () => ({ path: 'plugin.js', base: '.', module: plugin })
    let callbacks = [new WeakRef(loadStylesheet), new WeakRef(loadModule)]
    let compiler = await compile('@import "utilities"; @plugin "fixture";', {
      from: 'input.css',
      loadStylesheet,
      loadModule,
    })
    return { compiler, callbacks }
  }

  let { compiler, callbacks } = await createCompiler()
  for (let i = 0; i < 5; i++) {
    await setImmediate()
    Bun.gc(true)
  }

  expect(callbacks.map((callback) => callback.deref())).toEqual([undefined, undefined])
  expect(compiler.build(['flex'])).toContain('.flex {')
})
