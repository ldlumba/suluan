import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { CiteSection } from './CiteSection'

describe('cite section', () => {
  it('shows APA by default and switches formats without links', () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    render(
      <CiteSection
        record={{
          title: 'AidTrack',
          authors: ['Ronquillo, Aldyne A.'],
          year: '2026',
        }}
      />,
    )
    expect(
      screen.getByRole('heading', { name: 'Cite now' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ronquillo, A. A. \(2026\)/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'BibTeX' }))
    expect(
      screen.getByText(/@misc\{ronquillo2026aidtrack,/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'RIS' }))
    expect(screen.getByText(/TY - UNPB/)).toBeInTheDocument()
    expect(
      screen.getByText(/No verified external publication/),
    ).toBeInTheDocument()
  })

  it('copies the visible citation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <CiteSection record={{ title: 'AidTrack', authors: [], year: null }} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Copy citation' }))
    await screen.findByRole('button', { name: 'Copied' })
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('(n.d.)'))
  })

  it('shows the published version first when verified', () => {
    render(
      <CiteSection
        record={{ title: 'SoilScope', authors: ['Miclat, Juan'], year: '2026' }}
        publication={{
          doi: '10.1/x',
          venue: 'Test Journal',
          volume: '8',
          issue: '3',
          pages: '1-10',
          year: '2026',
        }}
      />,
    )
    expect(screen.getByText('Published version')).toBeInTheDocument()
    expect(screen.getByText('Repository record')).toBeInTheDocument()
    expect(screen.getByText(/Test Journal, 8\(3\)/)).toBeInTheDocument()
  })
})
