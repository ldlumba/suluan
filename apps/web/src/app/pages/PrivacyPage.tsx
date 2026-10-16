import { Link } from 'react-router'

/**
 * Public privacy notice. States only what the repository actually does:
 * Google sign-in identity, Neon profiles, submission/review retention,
 * quota counters, and memory-only assistant chat. No analytics, tracking,
 * or advertising claims are made because none are implemented.
 */
export function PrivacyPage() {
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <header className="border-b border-border pb-4">
        <h1 className="display-heading text-3xl font-semibold sm:text-4xl">
          Privacy notice
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          How SULUAN handles your information. Last updated October 2026.
        </p>
      </header>

      <div className="space-y-5 text-sm leading-7 text-[var(--ink-muted)]">
        <section aria-labelledby="privacy-identity">
          <h2
            id="privacy-identity"
            className="text-lg font-semibold text-foreground"
          >
            Sign-in and your account
          </h2>
          <p className="mt-2">
            SULUAN signs you in with your Google account through Firebase
            Authentication. Google shares your name, email address, and profile
            photo with the application. SULUAN stores your verified University
            of the Assumption email address, display name, and repository role
            in its project database to enforce access: only verified{' '}
            <span className="font-medium">ua.edu.ph</span> accounts can submit,
            review, or use signed-in discovery and AI features. Public search
            and public paper downloads work without signing in and store nothing
            about you.
          </p>
        </section>

        <section aria-labelledby="privacy-submissions">
          <h2
            id="privacy-submissions"
            className="text-lg font-semibold text-foreground"
          >
            Submissions and reviews
          </h2>
          <p className="mt-2">
            Papers you submit — title, authors, school, course, keywords, and
            the uploaded file — are retained for Research and Extension Office
            review, including rejected submissions, which stay in a review-only
            archive and are never published, indexed, or used as AI evidence.
            Accepted papers become repository records with the visibility you
            and the reviewer agree on. Decision notices are sent to your sign-in
            email address.
          </p>
        </section>

        <section aria-labelledby="privacy-ai">
          <h2 id="privacy-ai" className="text-lg font-semibold text-foreground">
            Search, semantic discovery, and the research assistant
          </h2>
          <p className="mt-2">
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

        <section aria-labelledby="privacy-sharing">
          <h2
            id="privacy-sharing"
            className="text-lg font-semibold text-foreground"
          >
            Sharing and contact
          </h2>
          <p className="mt-2">
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
