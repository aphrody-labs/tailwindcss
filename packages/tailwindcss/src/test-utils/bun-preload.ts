import { expect } from 'bun:test'
import serializer from './custom-serializer'

expect.addSnapshotSerializer(serializer as any)
