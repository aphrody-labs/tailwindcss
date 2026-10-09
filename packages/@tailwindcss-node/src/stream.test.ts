import { describe, expect, it } from 'bun:test'
import { compileStream } from './index'

function streamOf(...chunks: string[]) {
  let encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  let decoder = new TextDecoder()
  let output = ''
  for await (let chunk of stream) output += decoder.decode(chunk, { stream: true })
  return output + decoder.decode()
}

describe('compileStream', () => {
  it('compiles a chunked CSS stream with the given candidates', async () => {
    let output = await readAll(
      compileStream(streamOf('@tailwind utilities;\n@utility foo-', 'bar { color: blue; }'), {
        candidates: ['foo-bar', 'baz'],
      }),
    )

    expect(output).toContain('.foo-bar')
    expect(output).toContain('color: blue')
    expect(output).not.toContain('baz')
  })

  it('decodes a multi-byte character split across chunks', async () => {
    let bytes = new TextEncoder().encode('@tailwind utilities;\n@utility foo { content: "é"; }')
    let split = bytes.indexOf(0xc3) + 1
    let output = await readAll(
      compileStream(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes.subarray(0, split))
            controller.enqueue(bytes.subarray(split))
            controller.close()
          },
        }),
        { candidates: ['foo'] },
      ),
    )

    expect(output).toContain('content: "é"')
  })

  it('rejects when the CSS does not compile', async () => {
    await expect(
      readAll(compileStream(streamOf('.a { @apply unknown-utility; }'))),
    ).rejects.toThrow()
  })

  it('emits no utilities without candidates', async () => {
    let output = await readAll(
      compileStream(streamOf('@tailwind utilities;\n@utility foo-bar { color: blue; }')),
    )

    expect(output).not.toContain('.foo-bar')
  })
})
