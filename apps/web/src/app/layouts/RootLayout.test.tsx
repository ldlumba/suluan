import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { useAuth } from '@/features/auth/useAuth'
import { RootLayout } from './RootLayout'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: vi.fn() }))

describe('administrator navigation', () => {
  it('uses the role badge as the dashboard entry point and simplifies submissions', () => {
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
        name: 'Administrator — open admin dashboard',
      }),
    ).toHaveAttribute('href', '/admin')

    fireEvent.click(screen.getByRole('button', { name: 'Submissions' }))
    expect(
      screen.queryByRole('menuitem', { name: 'Admin dashboard' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Course availability' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Review queue' }),
    ).not.toBeInTheDocument()
  })
})
