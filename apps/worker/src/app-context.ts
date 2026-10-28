import type { profiles } from '@suluan/db/schema'
import type { VerifiedServiceIdentity } from './auth'
import type { Env } from './config'

export type Role = 'USER' | 'REPOSITORY_MANAGER' | 'ADMIN'

interface Variables {
  identity: { uid: string; email: string; emailVerified: boolean }
  profile: typeof profiles.$inferSelect
  serviceIdentity: VerifiedServiceIdentity
}

export type AppContext = { Bindings: Env; Variables: Variables }
