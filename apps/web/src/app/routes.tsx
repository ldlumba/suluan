import { createElement, lazy, Suspense } from 'react'
import { RootLayout } from './layouts/RootLayout'
import { HomePage } from './pages/HomePage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { SignInPage } from './pages/SignInPage'
import { ProtectedRoute } from '@/features/auth/ProtectedRoute'
import { NewSubmissionPage } from '@/features/submissions/NewSubmissionPage'
import { ReviewQueuePage } from '@/features/review/ReviewQueuePage'
import { SearchPage } from '@/features/search/SearchPage'
import { MySubmissionsPage } from '@/features/submissions/MySubmissionsPage'
import { PaperPage } from '@/features/search/PaperPage'
import { SemanticAccessPage } from '@/features/search/SemanticAccessPage'
import { AssistantPage } from '@/features/assistant/AssistantPage'
import { AdminCatalogPage } from '@/features/admin/AdminCatalogPage'
import { AdminUsersPage } from '@/features/admin/AdminUsersPage'
import { RepositoryOperationsPage } from '@/features/operations/RepositoryOperationsPage'

const graphPage = lazy(() =>
  import('@/features/graph/GraphPage').then((module) => ({
    default: module.GraphPage,
  })),
)
const graphAnalyticsPage = lazy(() =>
  import('@/features/graph/GraphAnalyticsPage').then((module) => ({
    default: module.GraphAnalyticsPage,
  })),
)

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
      { path: '/privacy', element: <PrivacyPage /> },
      // Search is public discovery: no ProtectedRoute wrapper.
      { path: '/search', element: <SearchPage /> },
      { path: '/search/semantic-access', element: <SemanticAccessPage /> },
      { path: '/assistant', element: <AssistantPage /> },
      { path: '/records/:id', element: <PaperPage /> },
      {
        path: '/graph',
        element: (
          <Suspense fallback={<p role="status">Loading graph…</p>}>
            {createElement(graphPage)}
          </Suspense>
        ),
      },
      {
        path: '/graph/analytics',
        element: (
          <Suspense fallback={<p role="status">Loading analytics…</p>}>
            {createElement(graphAnalyticsPage)}
          </Suspense>
        ),
      },
      {
        path: '/submissions',
        element: (
          <ProtectedRoute>
            <MySubmissionsPage />
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
      {
        path: '/operations',
        element: (
          <ProtectedRoute>
            <RepositoryOperationsPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/users',
        element: (
          <ProtectedRoute>
            <AdminUsersPage />
          </ProtectedRoute>
        ),
      },
      {
        path: '/admin/catalog',
        element: (
          <ProtectedRoute>
            <AdminCatalogPage />
          </ProtectedRoute>
        ),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
