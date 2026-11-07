import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { SignInPage } from './SignInPage'

vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('@/features/auth/SignInButton', () => ({
  SignInButton: () => <button>Sign in with Google</button>,
}))

describe('SignInPage', () => {
  it('shows the updated sign-in guidance', () => {
    render(
      <MemoryRouter>
        <SignInPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByText(
        'Use your authorized UA Google account to submit research, track its review, and use authenticated discovery tools.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Signing in confirms identity only/),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText(/accounts are admitted by default/),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Sign in with Google' }),
    ).toBeInTheDocument()
  })
})
