import { describe, expect, it } from 'vitest'
import { buildDownloadFileName } from '../src/uploads'

/**
 * Manager-download naming: the study title becomes the file name, the
 * original extension is preserved. No database needed — pure function.
 */
describe('buildDownloadFileName', () => {
  it('names the download after the study with the original extension', () => {
    expect(buildDownloadFileName('ILAW - Test Paper', 'ILAW Test.pdf')).toBe(
      'ILAW - Test Paper.pdf',
    )
  })

  it('preserves docx extensions', () => {
    expect(buildDownloadFileName('My Thesis', 'draft.docx')).toBe(
      'My Thesis.docx',
    )
  })

  it('sanitizes characters that are invalid in file names', () => {
    const name = buildDownloadFileName('A/B:C*D?E"F<G>H|I%J', 'paper.pdf')
    expect(name).toBe('A_B_C_D_E_F_G_H_I_J.pdf')
    expect(name).not.toMatch(/[\\/:"*?<>|%]/)
  })

  it('falls back to the original file name when the title is unusable', () => {
    expect(buildDownloadFileName('   ', 'paper.pdf')).toBe('paper.pdf')
  })
})
