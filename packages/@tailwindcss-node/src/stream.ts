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
  let buffer = ''

  let transform = new TransformStream<string, string>({
    transform(chunk) {
      buffer += chunk
    },
    async flush(controller) {
      let compiler = await compile(buffer, {
        ...compileOptions,
        base: compileOptions.base ?? process.cwd(),
        onDependency: compileOptions.onDependency ?? (() => {}),
      })
      controller.enqueue(compiler.build(candidates))
    },
  })

  return stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(transform)
    .pipeThrough(new TextEncoderStream())
}
