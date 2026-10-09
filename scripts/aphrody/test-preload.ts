// bun test preload: what packages/tailwindcss/vitest.config.mts sets for vitest.
// Needs `expect.addSnapshotSerializer` from the Aphrody Bun fork (984c0a12081);
// on another Bun the oklab snapshots of packages/tailwindcss will not match.
import { expect } from 'bun:test'
import serializer from '../../packages/tailwindcss/src/test-utils/custom-serializer.ts'

let addSnapshotSerializer = (expect as any).addSnapshotSerializer
if (typeof addSnapshotSerializer === 'function') {
  addSnapshotSerializer(serializer)
} else {
  console.warn(
    `test-preload: expect.addSnapshotSerializer is missing in Bun ${Bun.version}; ` +
      'use the Aphrody Bun fork (package.json packageManager) for snapshot parity.',
  )
}
