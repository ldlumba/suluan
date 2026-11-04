import { defineConfig } from 'vitest/config'
import { configureTestDatabase } from './scripts/test-db-safety.mjs'

configureTestDatabase(process.env)

export default defineConfig({})
