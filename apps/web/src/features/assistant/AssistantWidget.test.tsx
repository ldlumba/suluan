import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AssistantWidget } from './AssistantWidget'

vi.mock('./AssistantPage', () => ({
  AssistantPage: () => (
    <label>
      Draft
      <input />
    </label>
  ),
}))

describe('floating assistant', () => {
  it('opens on demand, keeps a draft when closed, and restores focus on Escape', () => {
    render(
      <MemoryRouter>
        <AssistantWidget />
      </MemoryRouter>,
    )
    const launcher = screen.getByRole('button', {
      name: 'Open research assistant',
    })
    expect(screen.queryByLabelText('Draft')).not.toBeInTheDocument()
    fireEvent.click(launcher)
    const draft = screen.getByLabelText('Draft')
    fireEvent.change(draft, { target: { value: 'A question' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(launcher).toHaveFocus()
    expect(launcher).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(launcher)
    expect(screen.getByLabelText('Draft')).toHaveValue('A question')
  })
})
