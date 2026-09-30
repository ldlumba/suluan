import { LibraryBig } from 'lucide-react'
import { Link, Outlet } from 'react-router'

export function RootLayout() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <LibraryBig className="h-5 w-5" aria-hidden="true" />
            SULUAN
          </Link>
          <nav className="ml-auto">
            <Link
              to="/"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Home
            </Link>
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
