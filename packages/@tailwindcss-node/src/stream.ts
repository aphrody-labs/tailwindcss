import { compile, type CompileOptions } from './compile'

export async function hashCandidates(candidates: string[] | Iterable<string>): Promise<string> {
  const encoder = new TextEncoder()
  const content = Array.isArray(candidates) ? candidates.join('\0') : Array.from(candidates).join('\0')
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(content))
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function compileStream(
  stream: ReadableStream<Uint8Array>,
  options?: CompileOptions & { candidates?: string[] },
): ReadableStream<Uint8Array> {
  const textDecoder = new TextDecoderStream()
  const textEncoder = new TextEncoderStream()
  let buffer = ''

  const transform = new TransformStream<string, string>({
    transform(chunk) {
      buffer += chunk
    },
    async flush(controller) {
      const compileOptions: CompileOptions = options ?? {
        base: process.cwd(),
        onDependency: () => {},
      }
      const compiler = await compile(buffer, compileOptions)
      const compiled = compiler.build(options?.candidates ?? [])
      controller.enqueue(compiled)
    },
  })

  return stream.pipeThrough(textDecoder).pipeThrough(transform).pipeThrough(textEncoder)
}
