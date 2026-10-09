// bun test preload: what packages/tailwindcss/vitest.config.mts sets for vitest.
// Needs `expect.addSnapshotSerializer` from the Aphrody Bun fork (984c0a12081).
import { expect } from 'bun:test'
import serializer from '../../packages/tailwindcss/src/test-utils/custom-serializer.ts'

try {
  ;(expect as any).addSnapshotSerializer?.(serializer as any)
} catch {}

