import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { RootLayout } from './RootLayout'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))

describe('administrator navigation', () => {
  it('uses the role badge as the account-roles entry point', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'admin@ua.edu.ph' },
      profile: { id: 'admin-1', role: 'ADMIN' },
      loading: false,
      signOut: vi.fn(),
    } as never)

    render(
      <MemoryRouter>
        <Routes>
          <Route element={<RootLayout />}>
            <Route index element={<p>Home</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('link', {
        name: 'Administrator — open account roles',
      }),
    ).toHaveAttribute('href', '/admin/users')

    fireEvent.click(screen.getByRole('button', { name: 'Submissions' }))
    expect(
      screen.queryByRole('link', { name: 'Account roles' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Course availability' }),
    ).toHaveAttribute('href', '/admin/catalog')
  })
})
