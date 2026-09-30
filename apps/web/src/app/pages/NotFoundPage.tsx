import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        The address you requested does not exist.{' '}
        <Link
          to="/"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Return home
        </Link>
      </p>
    </div>
  )
}
