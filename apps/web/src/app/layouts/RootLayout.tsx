import {
  ArrowUpRight,
  BookOpen,
  BriefcaseBusiness,
  ChevronDown,
  LibraryBig,
  LogOut,
  Menu,
  Network,
  Search,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'

export function RootLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mobileMenuRef = useRef<HTMLElement>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const workspaceButtonRef = useRef<HTMLButtonElement>(null)
  const { user, profile, loading, signOut } = useAuth()
  const manager = profile && profile.role !== 'USER'
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-2 border-b-2 px-1 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'border-[var(--highlight)] text-white'
        : 'border-transparent text-white/70 hover:border-white/40 hover:text-white'
    }`

  const closeMenu = () => setMenuOpen(false)
  const closeWorkspace = () => {
    setWorkspaceOpen(false)
    workspaceButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return
    const firstLink =
      mobileMenuRef.current?.querySelector<HTMLAnchorElement>(
        '[data-mobile-link]',
      )
    firstLink?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [menuOpen])

  useEffect(() => {
    if (!workspaceOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const items = Array.from(
        workspaceRef.current?.querySelectorAll<HTMLAnchorElement>(
          '[role="menuitem"]',
        ) ?? [],
      )
      const currentIndex = items.indexOf(
        document.activeElement as HTMLAnchorElement,
      )
      if (event.key === 'Escape') {
        event.preventDefault()
        closeWorkspace()
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        items[(currentIndex + 1) % items.length]?.focus()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        items[(currentIndex - 1 + items.length) % items.length]?.focus()
      } else if (event.key === 'Home') {
        event.preventDefault()
        items[0]?.focus()
      } else if (event.key === 'End') {
        event.preventDefault()
        items.at(-1)?.focus()
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!workspaceRef.current?.contains(event.target as Node))
        closeWorkspace()
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [workspaceOpen])

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-[6px] bg-[var(--highlight)] px-4 py-2 font-semibold text-[var(--foreground)] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <div className="bg-[var(--primary)] px-4 py-2 text-center text-[0.7rem] font-medium tracking-wide text-white/75 sm:px-6 sm:text-right">
        University of the Assumption · Research and Extension Office
      </div>
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[var(--primary)] text-white shadow-[0_1px_0_rgba(0,0,0,0.08)]">
        <div className="mx-auto flex min-h-[4.5rem] w-full max-w-7xl items-center gap-8 px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="group flex min-w-0 items-center gap-3"
            onClick={closeMenu}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[6px] bg-[var(--highlight)] text-[var(--primary)] transition-transform group-hover:-rotate-3">
              <LibraryBig className="size-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-lg font-bold tracking-[0.12em]">
                SULUAN
              </span>
              <span className="hidden text-[0.72rem] font-medium uppercase tracking-[0.12em] text-white/60 sm:block">
                UA research repository
              </span>
            </span>
          </Link>
          <nav
            className="ml-auto hidden items-center gap-6 lg:flex"
            aria-label="Primary navigation"
          >
            <NavLink to="/search" className={navClass}>
              <Search className="size-4" aria-hidden="true" /> Search
            </NavLink>
            <NavLink to="/graph" className={navClass}>
              <Network className="size-4" aria-hidden="true" /> Graph
            </NavLink>
            <div ref={workspaceRef} className="relative">
              <Button
                ref={workspaceButtonRef}
                variant="ghost"
                size="sm"
                className="gap-2 border-b-2 border-transparent px-1 py-2 text-sm font-medium text-white/70 hover:bg-transparent hover:text-white"
                aria-expanded={workspaceOpen}
                aria-controls="workspace-menu"
                onClick={() => setWorkspaceOpen((open) => !open)}
              >
                <BriefcaseBusiness className="size-4" aria-hidden="true" />
                Submissions
                <ChevronDown
                  className={`size-3.5 transition-transform ${workspaceOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </Button>
              {workspaceOpen && (
                <div
                  id="workspace-menu"
                  className="absolute right-0 top-full z-50 mt-3 w-56 rounded-[8px] border border-white/15 bg-[var(--primary)] p-2 shadow-lg"
                  role="menu"
                >
                  <WorkspaceLink to="/submit" onClick={closeWorkspace}>
                    <BookOpen className="size-4" aria-hidden="true" /> Submit
                    research
                  </WorkspaceLink>
                  {user && (
                    <WorkspaceLink to="/submissions" onClick={closeWorkspace}>
                      My submissions
                    </WorkspaceLink>
                  )}
                  {manager && (
                    <>
                      <WorkspaceLink to="/review" onClick={closeWorkspace}>
                        Review queue
                      </WorkspaceLink>
                      <WorkspaceLink
                        to="/graph/analytics"
                        onClick={closeWorkspace}
                      >
                        Analytics
                      </WorkspaceLink>
                    </>
                  )}
                </div>
              )}
            </div>
            <span className="ml-2 h-6 w-px bg-white/20" aria-hidden="true" />
            {loading ? null : user ? (
              <>
                <span className="hidden max-w-48 truncate text-xs text-white/60 xl:inline">
                  {user.email}
                </span>
                {profile && (
                  <span className="rounded-[4px] border border-[var(--highlight)]/60 px-2 py-1 text-[0.72rem] font-bold tracking-[0.08em] text-[var(--highlight)]">
                    {profile.role}
                  </span>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="border-white/30 bg-transparent text-white hover:bg-white hover:text-[var(--primary)]"
                  onClick={() => void signOut()}
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </Button>
              </>
            ) : (
              <Link
                to="/signin"
                className="inline-flex items-center gap-2 rounded-[6px] bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--highlight)] hover:text-[var(--foreground)]"
              >
                Sign in <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </nav>
          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            className="ml-auto size-11 text-white hover:bg-white/10 hover:text-white lg:hidden"
            aria-label={
              menuOpen ? 'Close navigation menu' : 'Open navigation menu'
            }
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
        {menuOpen && (
          <nav
            ref={mobileMenuRef}
            id="mobile-navigation"
            className="border-t border-white/10 bg-[var(--primary)] px-4 py-4 lg:hidden"
            aria-label="Mobile navigation"
          >
            <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:px-2">
              <MobileLink to="/search" icon={<Search />} onClick={closeMenu}>
                Search the repository
              </MobileLink>
              <MobileLink to="/graph" icon={<Network />} onClick={closeMenu}>
                Research graph
              </MobileLink>
              <MobileLink to="/submit" icon={<BookOpen />} onClick={closeMenu}>
                Submit research
              </MobileLink>
              {user && (
                <MobileLink to="/submissions" onClick={closeMenu}>
                  My submissions
                </MobileLink>
              )}
              {manager && (
                <MobileLink to="/review" onClick={closeMenu}>
                  Review queue
                </MobileLink>
              )}
              {manager && (
                <MobileLink to="/graph/analytics" onClick={closeMenu}>
                  Analytics
                </MobileLink>
              )}
              {user && (
                <div className="flex items-center justify-between border-t border-white/10 px-3 pt-3 text-xs text-white/60">
                  <span>{user.email}</span>
                  {profile && (
                    <span className="font-bold tracking-[0.08em] text-[var(--highlight)]">
                      {profile.role}
                    </span>
                  )}
                </div>
              )}
              {user && (
                <Button
                  variant="ghost"
                  className="justify-start px-3 py-3 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
                  onClick={() => {
                    closeMenu()
                    void signOut()
                  }}
                >
                  <LogOut className="size-4" aria-hidden="true" /> Sign out
                </Button>
              )}
              {!loading && !user && (
                <MobileLink to="/signin" onClick={closeMenu}>
                  Sign in
                </MobileLink>
              )}
            </div>
          </nav>
        )}
      </header>
      <main
        id="main-content"
        className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12"
      >
        <Outlet />
      </main>
      <footer className="border-t border-[var(--border)] bg-white">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>
            © {new Date().getFullYear()} University of the Assumption · SULUAN
          </p>
          <p className="text-xs">A governed home for UA research.</p>
        </div>
      </footer>
    </div>
  )
}

function MobileLink({
  to,
  children,
  icon,
  onClick,
}: {
  to: string
  children: ReactNode
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <Link
      data-mobile-link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3 rounded-[6px] px-3 py-3 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
    >
      {icon && <span className="[&_svg]:size-4">{icon}</span>}
      {children}
    </Link>
  )
}

function WorkspaceLink({
  to,
  children,
  onClick,
}: {
  to: string
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="flex items-center gap-3 rounded-[6px] px-3 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
    >
      {children}
    </Link>
  )
}
