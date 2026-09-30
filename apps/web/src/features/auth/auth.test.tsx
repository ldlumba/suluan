import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

vi.mock('@/lib/firebase', () => ({
  auth: { __mock: true },
  googleProvider: { __mock: true },
  isFirebaseConfigured: true,
}))

const { mockOnAuthStateChanged, mockSignOut } = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn(),
  mockSignOut: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: mockOnAuthStateChanged,
  signInWithPopup: vi.fn(),
  signOut: mockSignOut,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSignOut.mockResolvedValue(undefined)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ id: 'p1', email: 'u@ua.edu.ph', role: 'USER' }),
    }),
  )
})

describe('AuthProvider sign-out', () => {
  it('clears user and profile state', async () => {
    let listener: ((u: unknown) => void) | null = null
    mockOnAuthStateChanged.mockImplementation(
      (_auth: unknown, cb: (u: unknown) => void) => {
        listener = cb
        return () => {}
      },
    )
    function Probe() {
      const { user, profile, loading, signOut } = useAuth()
      return (
        <div>
          <span data-testid="state">
            {loading
              ? 'loading'
              : user
                ? `user:${(user as { email: string }).email}`
                : 'signed-out'}
          </span>
          <span data-testid="role">
            {profile ? profile.role : 'no-profile'}
          </span>
          <button onClick={() => void signOut()}>out</button>
        </div>
      )
    }
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    await act(async () => {
      listener?.({
        email: 'u@ua.edu.ph',
        getIdToken: () => Promise.resolve('tok'),
      })
    })
    expect(screen.getByTestId('state')).toHaveTextContent('user:u@ua.edu.ph')
    expect(screen.getByTestId('role')).toHaveTextContent('USER')
    fireEvent.click(screen.getByRole('button', { name: 'out' }))
    expect(mockSignOut).toHaveBeenCalled()
    expect(await screen.findByText('signed-out')).toBeInTheDocument()
    expect(screen.getByTestId('role')).toHaveTextContent('no-profile')
  })
})
