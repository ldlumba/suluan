import { RootLayout } from './layouts/RootLayout'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SignInPage } from './pages/SignInPage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { NewSubmissionPage } from '@/features/submissions/NewSubmissionPage'
import { ReviewQueuePage } from '@/features/review/ReviewQueuePage'
import { SearchPage } from '@/features/search/SearchPage'

/**
 * Route configuration, kept separate from the browser router instance so
 * tests can mount it with a memory router.
 */
export const routes = [
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/signin', element: <SignInPage /> },
      {
        path: '/search',
        element: (
          <ProtectedRoute>
            <SearchPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/submit',
        element: (
          <ProtectedRoute>
            <NewSubmissionPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/review',
        element: (
          <ProtectedRoute>
            <ReviewQueuePage />
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
