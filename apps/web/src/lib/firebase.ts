import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'

/**
 * Firebase CLIENT configuration only. Everything here ships in the built
 * bundle and is publicly recoverable — it is not a credential and never
 * authorizes anything. Authorization happens in Workers against Neon.
 * Missing config (e.g. CI without .env.local) disables sign-in UI only;
 * the rest of the app still builds and runs.
 */
function readConfig() {
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
  }
}

const config = readConfig()

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId)

let auth: Auth | null = null
let googleProvider: GoogleAuthProvider | null = null

if (isFirebaseConfigured) {
  auth = getAuth(initializeApp(config))
  googleProvider = new GoogleAuthProvider()
  // Request the account chooser every time so shared/lab machines do not
  // silently reuse the last Google session.
  googleProvider.setCustomParameters({ prompt: 'select_account' })
}

export { auth, googleProvider }
