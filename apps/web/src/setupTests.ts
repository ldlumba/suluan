import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so testing-library's auto-cleanup never
// registers. Without this, renders leak between tests in the same file.
afterEach(() => {
  cleanup()
})
