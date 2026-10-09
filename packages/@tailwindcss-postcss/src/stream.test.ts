import { describe, expect, it } from 'bun:test'
import { compileStream, hashCandidates } from './index'

describe('@tailwindcss/postcss web features', () => {
  it('hashes candidate lists consistently using crypto.subtle', async () => {
    const list = ['font-bold', 'text-center', 'm-2']
    const hashA = await hashCandidates(list)
    const hashB = await hashCandidates([...list])
    expect(hashA).toBe(hashB)
    expect(typeof hashA).toBe('string')
    expect(hashA.length).toBe(64) // SHA-256 hex string

    const hashDifferent = await hashCandidates(['font-bold', 'text-left'])
    expect(hashA).not.toBe(hashDifferent)
  })

  it('compiles CSS via native Web Streams (ReadableStream)', async () => {
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const css = '@utility test-stream { display: flex; }'

    const inStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(css))
        controller.close()
      },
    })

    const outStream = compileStream(inStream)
    let output = ''
    for await (const chunk of outStream) {
      output += decoder.decode(chunk)
    }

    expect(output).toContain('test-stream')
  })
})
