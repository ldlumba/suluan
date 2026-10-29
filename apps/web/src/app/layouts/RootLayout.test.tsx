import { fireEvent, render, screen, within } from '@testing-library/react'
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

it('shows a short confirmation after successful sign-out', async () => {
  vi.mocked(useAuth).mockReturnValue({
    user: { email: 'user@ua.edu.ph' },
    profile: { id: 'u1', role: 'USER' },
    loading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
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
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Sign out',
    }),
  )
  expect(
    await screen.findByText('You have successfully signed out.'),
  ).toBeInTheDocument()
})

it('sends sign-out from another page to home', async () => {
  vi.mocked(useAuth).mockReturnValue({
    user: { email: 'user@ua.edu.ph' },
    profile: { role: 'USER' },
    loading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
  } as never)
  render(
    <MemoryRouter initialEntries={['/other']}>
      <Routes>
        <Route element={<RootLayout />}>
          <Route index element={<p>Home destination</p>} />
          <Route path="/other" element={<p>Other page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Sign out',
    }),
  )
  expect(await screen.findByText('Home destination')).toBeInTheDocument()
  expect(
    screen.getByText('You have successfully signed out.'),
  ).toBeInTheDocument()
})

it('provides the manager dashboard through a readable role badge', () => {
  vi.mocked(useAuth).mockReturnValue({
    user: {},
    profile: { role: 'REPOSITORY_MANAGER' },
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
    screen.getByRole('link', { name: 'Repository manager — open dashboard' }),
  ).toHaveAttribute('href', '/manager')
  expect(screen.getByText('REPO')).toBeInTheDocument()
})
