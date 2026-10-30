import { Bot, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { AssistantPage } from './AssistantPage'

export function AssistantWidget() {
  const [open, setOpen] = useState(false)
  const [openedOnce, setOpenedOnce] = useState(false)
  const launcher = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const location = useLocation()

  function openAssistant() {
    setOpenedOnce(true)
    setOpen(true)
  }

  function closeAssistant() {
    setOpen(false)
    launcher.current?.focus()
  }

  useEffect(() => {
    if ((location.state as { openAssistant?: boolean } | null)?.openAssistant) {
      const timer = window.setTimeout(() => {
        setOpenedOnce(true)
        setOpen(true)
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [location.key, location.state])

  useEffect(() => {
    if (!open) return
    closeButton.current?.focus()
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        launcher.current?.focus()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open])

  return (
    <>
      <button
        ref={launcher}
        type="button"
        aria-label="Open research assistant"
        aria-expanded={open}
        aria-controls="assistant-panel"
        onClick={openAssistant}
        className="fixed bottom-4 right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--primary)] px-4 py-3 text-sm font-semibold text-white shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
      >
        <Bot className="size-5" aria-hidden="true" />{' '}
        <span>Research assistant</span>
      </button>
      {openedOnce && (
        <section
          id="assistant-panel"
          role="region"
          aria-label="Research assistant"
          hidden={!open}
          className={`fixed inset-x-2 bottom-2 top-2 z-50 ${open ? 'flex' : 'hidden'} flex-col overflow-hidden rounded-lg border border-border bg-white shadow-xl sm:inset-auto sm:bottom-20 sm:right-4 sm:h-[min(44rem,calc(100dvh-7rem))] sm:w-[min(32rem,calc(100vw-2rem))]`}
        >
          <div className="flex shrink-0 items-center justify-between bg-[var(--primary)] px-4 py-2 text-white">
            <h2 className="font-semibold">Research assistant</h2>
            <button
              ref={closeButton}
              type="button"
              aria-label="Close research assistant"
              onClick={closeAssistant}
              className="grid size-11 place-items-center rounded hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <AssistantPage floating />
          </div>
        </section>
      )}
    </>
  )
}
