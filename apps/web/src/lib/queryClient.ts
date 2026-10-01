import { QueryClient } from '@tanstack/react-query'

/**
 * Single shared query client. Conservative defaults: no automatic retries
 * on mutations (never replay submissions, decisions, uploads, or billable
 * AI actions without a safe contract), no refetch-on-focus storms.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
})
