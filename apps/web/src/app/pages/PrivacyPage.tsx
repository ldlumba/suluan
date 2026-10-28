import { Link } from 'react-router'

/**
 * Public privacy notice. States only what the repository actually does:
 * Google sign-in identity, Neon profiles, submission/review retention,
 * quota counters, and memory-only assistant chat. No analytics, tracking,
 * or advertising claims are made because none are implemented.
 */
export function PrivacyPage() {
  return (
    <section className="mx-auto max-w-4xl space-y-10">
      <header className="grid gap-5 border-b border-border pb-8 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <p className="eyebrow text-[var(--impact)]">Public information</p>
          <h1 className="display-heading mt-3 text-4xl font-semibold sm:text-5xl">
            Privacy notice
          </h1>
        </div>
        <p className="max-w-xs text-sm leading-6 text-muted-foreground sm:text-right">
          How SULUAN handles your information.
          <br /> Last updated October 2026.
        </p>
      </header>

      <div className="text-sm leading-7 text-[var(--ink-muted)]">
        <section
          aria-labelledby="privacy-identity"
          className="grid gap-3 border-b border-[var(--border)] py-7 first:pt-0 md:grid-cols-[2rem_15rem_1fr] md:gap-6"
        >
          <span className="font-mono text-xs text-[var(--ink-muted)]">01</span>
          <h2
            id="privacy-identity"
            className="text-lg font-semibold text-foreground"
          >
            Sign-in and your account
          </h2>
          <p>
            SULUAN signs you in with your Google account through Firebase
            Authentication. Google shares your name, email address, and profile
            photo with the application. SULUAN stores your verified email
            address, display name, and repository role in its project database
            to enforce access. Verified{' '}
            <span className="font-medium">ua.edu.ph</span> accounts are admitted
            by default; specifically authorized evaluation accounts may receive
            the same signed-in access for a documented, time-limited assessment.
            Public search and public paper downloads work without signing in and
            store nothing about you.
          </p>
        </section>

        <section
          aria-labelledby="privacy-submissions"
          className="grid gap-3 border-b border-[var(--border)] py-7 md:grid-cols-[2rem_15rem_1fr] md:gap-6"
        >
          <span className="font-mono text-xs text-[var(--ink-muted)]">02</span>
          <h2
            id="privacy-submissions"
            className="text-lg font-semibold text-foreground"
          >
            Submissions and reviews
          </h2>
          <p>
            Papers you submit — title, authors, school, course, keywords, and
            the uploaded file — are retained for Research and Extension Office
            review, including rejected submissions, which stay in a review-only
            archive and are never published, indexed, or used as AI evidence.
            Accepted papers become repository records with the visibility you
            and the reviewer agree on. Decision notices are sent to your sign-in
            email address.
          </p>
        </section>

        <section
          aria-labelledby="privacy-ai"
          className="grid gap-3 border-b border-[var(--border)] py-7 md:grid-cols-[2rem_15rem_1fr] md:gap-6"
        >
          <span className="font-mono text-xs text-[var(--ink-muted)]">03</span>
          <h2 id="privacy-ai" className="text-lg font-semibold text-foreground">
            Search, semantic discovery, and the research assistant
          </h2>
          <p>
            Keyword search runs against repository text stored in the project
            database. Meaning-based (semantic) search and the research assistant
            send your query text to Google&apos;s Gemini API through a regional
            service; the provider processes the request under Google&apos;s
            paid-service terms. Assistant conversations are kept in your browser
            memory only — SULUAN does not save your chat text. Daily usage
            counters (for example, messages per day) are stored per account to
            enforce published limits. Do not include personal, confidential, or
            unpublished information in submissions or assistant questions.
          </p>
        </section>

        <section
          aria-labelledby="privacy-sharing"
          className="grid gap-3 py-7 md:grid-cols-[2rem_15rem_1fr] md:gap-6"
        >
          <span className="font-mono text-xs text-[var(--ink-muted)]">04</span>
          <h2
            id="privacy-sharing"
            className="text-lg font-semibold text-foreground"
          >
            Sharing and contact
          </h2>
          <p>
            SULUAN does not sell personal information and runs no advertising or
            cross-site tracking. Operational providers (hosting, database, email
            delivery, AI processing) handle data only to operate the repository.
            For corrections, withdrawal requests, or questions about this
            notice, contact the Research and Extension Office through the review
            mailbox shown on decision notices, or{' '}
            <Link to="/signin" className="underline">
              sign in
            </Link>{' '}
            and reply to any SULUAN notification you received.
          </p>
        </section>
      </div>
    </section>
  )
}
