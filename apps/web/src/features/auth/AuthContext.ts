import { createContext } from 'react'
import type { User } from 'firebase/auth'

export interface ServerProfile {
  id: string
  email: string | null
  role: 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN'
}

export interface AuthState {
  /** Firebase identity only — never a permission grant. */
  user: User | null
  /** Authoritative role/profile from the Workers API (null until loaded). */
  profile: ServerProfile | null
  loading: boolean
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
