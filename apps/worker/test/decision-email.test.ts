import { describe, expect, it } from 'vitest'
import { decisionEmailText } from '../src/notifications'

describe('decision email wording', () => {
  it('presents rejected decisions as returned with remarks', () => {
    const email = decisionEmailText({
      status: 'REJECTED',
      title: 'Paper',
      submissionId: '123',
      remarks: 'Please revise.',
    })
    expect(email.subject).toContain('was returned')
    expect(email.body).toContain('Decision: Returned')
    expect(email.body).toContain('Remarks: Please revise.')
    expect(email.body).not.toContain('REJECTED')
  })
  it('presents accepted decisions as accepted', () => {
    expect(decisionEmailText({ status: 'ACCEPTED' }).body).toContain(
      'Decision: Accepted',
    )
  })
})
