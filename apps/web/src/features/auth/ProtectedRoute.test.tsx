import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { useAuth } from './useAuth'
import { ProtectedRoute } from './ProtectedRoute'

vi.mock('./useAuth', () => ({ useAuth: vi.fn() }))

const mockedUseAuth = vi.mocked(useAuth)

function renderProtected(authValue: { user: unknown; loading: boolean }) {
  mockedUseAuth.mockReturnValue({
    user: authValue.user,
    profile: null,
    loading: authValue.loading,
    error: null,
    signIn: vi.fn(),
    signOut: vi.fn(),
  } as never)
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ProtectedRoute>
            <p>secret content</p>
          </ProtectedRoute>
        ),
      },
      { path: '/signin', element: <p>signin page</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
}

describe('ProtectedRoute', () => {
  it('redirects signed-out users to /signin', async () => {
    renderProtected({ user: null, loading: false })
    expect(await screen.findByText('signin page')).toBeInTheDocument()
    expect(screen.queryByText('secret content')).not.toBeInTheDocument()
  })

  it('renders children for signed-in users', async () => {
    renderProtected({ user: { email: 'u@ua.edu.ph' }, loading: false })
    expect(await screen.findByText('secret content')).toBeInTheDocument()
  })

  it('waits while auth state loads instead of redirecting', () => {
    renderProtected({ user: null, loading: true })
    expect(screen.getByText(/checking sign-in/i)).toBeInTheDocument()
    expect(screen.queryByText('signin page')).not.toBeInTheDocument()
  })
})
