import { LibraryBig, LogOut } from 'lucide-react'
import { Link, Outlet } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'

export function RootLayout() {
  const { user, profile, loading, signOut } = useAuth()
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <LibraryBig className="h-5 w-5" aria-hidden="true" />
            SULUAN
          </Link>
          <nav className="ml-auto flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Home
            </Link>
            <Link
              to="/submit"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Submit
            </Link>
            {profile && profile.role !== 'USER' && (
              <Link
                to="/search"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Search
              </Link>
            )}
            {profile && profile.role !== 'USER' && (
              <Link
                to="/review"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Review
              </Link>
            )}
            {loading ? null : user ? (
              <>
                {profile && (
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    {profile.role}
                  </span>
                )}
                <span className="hidden max-w-48 truncate text-sm md:inline">
                  {user.email}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void signOut()}
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </Button>
              </>
            ) : (
              <Link
                to="/signin"
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t py-4 text-center text-sm text-muted-foreground">
        UA Research and Extension Office — application scaffold, features arrive
        with their architecture stages.
      </footer>
    </div>
  )
}
