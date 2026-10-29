import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from './useAuth'
import { SignInButton } from './SignInButton'

vi.mock('./useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ isFirebaseConfigured: true }))

describe('SignInButton navigation', () => {
  it('sends an administrator signing in from home to the admin dashboard', async () => {
    vi.mocked(useAuth).mockReturnValue({
      signIn: vi.fn().mockResolvedValue({
        id: 'admin-1',
        email: 'admin@ua.edu.ph',
        role: 'ADMIN',
      }),
      error: null,
    } as never)

    render(
      <MemoryRouter initialEntries={['/signin?returnTo=%2F']}>
        <Routes>
          <Route path="/signin" element={<SignInButton />} />
          <Route path="/admin" element={<p>Admin dashboard destination</p>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    expect(
      await screen.findByText('Admin dashboard destination'),
    ).toBeInTheDocument()
  })

  it('preserves a specific protected-page return destination', async () => {
    vi.mocked(useAuth).mockReturnValue({
      signIn: vi.fn().mockResolvedValue({
        id: 'admin-1',
        email: 'admin@ua.edu.ph',
        role: 'ADMIN',
      }),
      error: null,
    } as never)

    render(
      <MemoryRouter initialEntries={['/signin?returnTo=%2Freview']}>
        <Routes>
          <Route path="/signin" element={<SignInButton />} />
          <Route path="/review" element={<p>Review destination</p>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    await waitFor(() =>
      expect(screen.getByText('Review destination')).toBeInTheDocument(),
    )
  })
})
