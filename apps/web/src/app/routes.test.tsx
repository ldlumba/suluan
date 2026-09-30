import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { routes } from './routes'

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(<RouterProvider router={router} />)
}

describe('app routing', () => {
  it('renders the placeholder home screen at /', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'SULUAN' })).toBeInTheDocument()
    expect(screen.getByText(/no features are wired yet/i)).toBeInTheDocument()
  })

  it('renders the not-found screen for unknown routes', () => {
    renderAt('/does-not-exist')
    expect(
      screen.getByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument()
  })
})
