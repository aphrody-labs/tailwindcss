import { compile, type CompileOptions } from './compile'

/**
 * Compiles a CSS stream with `compile()` and emits the result of
 * `compiler.build(candidates)`. The input is buffered until the stream ends.
 * No source scanning happens here: pass the candidates explicitly.
 */
export function compileStream(
  stream: ReadableStream<Uint8Array>,
  options: Partial<CompileOptions> & { candidates?: string[] } = {},
): ReadableStream<Uint8Array> {
  let { candidates = [], ...compileOptions } = options
  let decoder = new TextDecoder()
  let buffer = ''

  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk) {
        buffer += decoder.decode(chunk, { stream: true })
      },
      async flush(controller) {
        buffer += decoder.decode()
        let compiler = await compile(buffer, {
          ...compileOptions,
          base: compileOptions.base ?? process.cwd(),
          onDependency: compileOptions.onDependency ?? (() => {}),
        })
        controller.enqueue(new TextEncoder().encode(compiler.build(candidates)))
      },
    }),
  )
}
