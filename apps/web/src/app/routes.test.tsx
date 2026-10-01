import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

describe('app routing', () => {
  it('renders the placeholder home screen at /', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'SULUAN' })).toBeInTheDocument()
    expect(screen.getByText(/no features are wired yet/i)).toBeInTheDocument()
  })

  it('renders the sign-in screen at /signin', () => {
    renderAt('/signin')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('redirects signed-out visitors away from /submit and /review', async () => {
    renderAt('/submit')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('renders the not-found screen for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
  })
})
