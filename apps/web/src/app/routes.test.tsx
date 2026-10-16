import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
}

describe('app routing', () => {
  it('renders the repository home screen at /', () => {
    renderAt('/')
    expect(
      screen.getByRole('heading', {
        name: /Find the work that moves UA forward/i,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /Explore the repository/i }),
    ).toBeInTheDocument()
  })

  it('renders the sign-in screen at /signin', () => {
    renderAt('/signin')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('renders the semantic access explanation for public visitors', () => {
    renderAt('/search/semantic-access?q=humidity')
    expect(
      screen.getByRole('heading', { name: 'Sign in to use semantic search' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /use keyword search/i }),
    ).toHaveAttribute('href', '/search?q=humidity')
  })

  it('renders the public graph entry screen at /graph', async () => {
    renderAt('/graph')
    expect(
      // React Flow's lazy module can exceed the default 1s on cold CI runs.
      await screen.findByRole(
        'heading',
        { name: 'Research relationships' },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument()
  })

  it('redirects signed-out visitors away from /submit and /review', async () => {
    renderAt('/submit')
    expect(
      await screen.findByRole('heading', { name: 'Sign in' }),
    ).toBeInTheDocument()
  })

  it('renders the privacy notice at /privacy', () => {
    renderAt('/privacy')
    expect(
      screen.getByRole('heading', { name: 'Privacy notice' }),
    ).toBeInTheDocument()
  })

  it('renders the not-found screen for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
  })
})
