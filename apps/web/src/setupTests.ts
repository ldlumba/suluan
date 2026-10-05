import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// React Flow observes its viewport. jsdom has no layout engine or native
// ResizeObserver, so tests use a no-op structural stand-in.
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver as typeof ResizeObserver

// Vitest runs without globals, so testing-library's auto-cleanup never
// registers. Without this, renders leak between tests in the same file.
afterEach(() => {
  cleanup()
})
