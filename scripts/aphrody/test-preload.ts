// bun test preload: what packages/tailwindcss/vitest.config.mts sets for vitest.
// Needs `expect.addSnapshotSerializer` from the Aphrody Bun fork (984c0a12081);
// on another Bun the oklab snapshots of packages/tailwindcss will not match.
import { expect } from 'bun:test'
import serializer from '../../packages/tailwindcss/src/test-utils/custom-serializer.ts'

try {
  ;(expect as any).addSnapshotSerializer(serializer)
} catch (error) {
  // Bun releases before 984c0a12081 lack the method or throw "Not implemented".
  console.warn(
    `test-preload: expect.addSnapshotSerializer is unavailable in Bun ${Bun.version} (${error}); ` +
      'use the Aphrody Bun fork (package.json packageManager) for snapshot parity.',
  )
}
