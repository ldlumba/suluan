import { Hono, type MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { sql } from 'drizzle-orm'
import type { AppContext } from './app'
import { createDb, type Db } from './db'
import {
  ASSISTANT_LIMITS,
  retrieveAssistantEvidence,
  type AssistantEvidence,
} from './assistant'
import { consumeQuota, embeddingLimits, interactiveLimits } from './quota'
import { normalizeVector, EMBEDDING_DIMS } from './embeddings'
import { effectiveVisibility, viewerRoleFor } from './visibility'
import { CHUNKER_VERSION } from './chunking'

export function assistantPilotAllowed(email: string, allowlist?: string) {
  return Boolean(
    allowlist
      ?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .includes(email.toLowerCase()),
  )
}

export function assistantAccessAllowed(
  email: string,
  mode: 'pilot' | 'all_authenticated' | undefined,
  allowlist?: string,
) {
  return mode === 'all_authenticated' || assistantPilotAllowed(email, allowlist)
}

/** Erase abandoned request digests without deleting operational audit metadata. */
export async function expireAssistantRequests(db: Db) {
  await db.execute(sql`update assistant_requests set status = 'expired',
    embed_hash = null, generate_hash = null
    where id in (select id from assistant_requests
      where status = 'reserved' and expires_at <= now() order by expires_at limit 300)`)
}

const requestSchema = z
  .object({
    requestId: z.string().uuid(),
    sessionId: z.string().uuid(),
    prompt: z.string().trim().min(1).max(ASSISTANT_LIMITS.promptChars),
    adultConfirmed: z.boolean().optional(),
    history: z
      .array(
        z
          .object({
            question: z.string().max(ASSISTANT_LIMITS.promptChars),
            answer: z.string().max(6000),
          })
          .strict(),
      )
      // Only recent context is sent even though a conversation may last longer.
      .max(4)
      .default([]),
  })
  .strict()

export const answerSchema = z
  .object({
    mode: z.enum([
      'grounded_answer',
      'related_research',
      'general_guidance',
      'clarification',
    ]),
    paragraphs: z
      .array(
        z
          .object({
            text: z.string().trim().min(1).max(2000),
            citations: z.array(z.string().regex(/^S[1-5]$/)).max(5),
          })
          .strict(),
      )
      .max(5),
  })
  .strict()

export function validateAnswer(raw: unknown, sourceIds: string[]) {
  const answer = answerSchema.parse(raw)
  if (!answer.paragraphs.length) throw new Error('Missing answer')
  if (answer.paragraphs.reduce((n, p) => n + p.text.length, 0) > 6000)
    throw new Error('Oversize answer')
  for (const paragraph of answer.paragraphs) {
    if (paragraph.citations.some((id) => !sourceIds.includes(id)))
      throw new Error('Unknown citation')
  }
  const citationCount = answer.paragraphs.reduce(
    (count, paragraph) => count + paragraph.citations.length,
    0,
  )
  if (
    answer.mode === 'grounded_answer' &&
    answer.paragraphs.some((paragraph) => !paragraph.citations.length)
  ) {
    throw new Error('Ungrounded repository answer')
  }
  if (answer.mode === 'related_research' && !citationCount)
    throw new Error('Missing related source')
  if (
    (answer.mode === 'general_guidance' || answer.mode === 'clarification') &&
    citationCount
  ) {
    throw new Error('General response cannot cite repository evidence')
  }
  return answer
}

/** Build bounded retrieval context from user questions only, never prior answers. */
export function buildAssistantRetrievalQuery(
  prompt: string,
  history: { question: string }[],
) {
  if (prompt.length >= ASSISTANT_LIMITS.promptChars - 100) return prompt
  let query = prompt
  for (const turn of [...history].reverse()) {
    const addition = `\nEarlier question: ${turn.question}`
    if (query.length + addition.length > ASSISTANT_LIMITS.promptChars) break
    query += addition
  }
  return query
}

export async function hashPayload(payload: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export function assistantEndpoint(origin: string, stage: 'embed' | 'generate') {
  const url = new URL(origin)
  if (
    url.protocol !== 'https:' ||
    !url.hostname.endsWith('.run.app') ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Invalid assistant origin')
  }
  return `${url.origin}/${stage}`
}

// Body is bounded while reading, including chunked provider responses.
async function boundedJson(response: Response) {
  if (!response.ok || !response.body) throw new Error('Service unavailable')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > 64_000) throw new Error('Response too large')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

async function regionalCall(
  db: Db,
  origin: string,
  requestId: string,
  ticket: string,
  stage: 'embed' | 'generate',
  data: unknown,
) {
  const payload = JSON.stringify(data)
  const hash = await hashPayload(payload)
  const field = stage === 'embed' ? sql`embed_hash` : sql`generate_hash`
  await db.execute(sql`update assistant_requests set ${field} = ${hash}
    where id = ${requestId} and status = 'reserved' and expires_at > now()`)
  // Match the deployed query transport: this Workers runtime rejects the
  // browser-style signal/redirect options. Cloud Run bounds requests to 60s.
  return await boundedJson(
    await fetch(assistantEndpoint(origin, stage), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket, payload }),
    }),
  )
}

/** Recheck current extraction and effective PUBLIC policy before/after generation. */
export async function evidenceStillPublic(
  db: Db,
  evidence: AssistantEvidence[],
) {
  if (!evidence.length) return false
  const ids = sql.join(
    evidence.map((item) => sql`${item.chunkId}::uuid`),
    sql`, `,
  )
  const rows = await db.execute(sql`
    select d.id from document_chunks d
    join keyword_indexes k on k.id = d.index_id
    join research_records r on r.id = k.record_id
    join submissions s on s.id = r.submission_id and s.status = 'ACCEPTED'
    join processing_jobs j on j.record_id = r.id and j.status = 'EXTRACTED'
      and j.claim_token = k.extraction_claim_token
    where d.id in (${ids}) and k.chunker_version = ${CHUNKER_VERSION}
      and ${effectiveVisibility('PUBLIC', 'r').rowVisible}
  `)
  return rows.rows.length === evidence.length
}

/** All counters are reserved BEFORE embedding/generation. Failed attempts are not refunded. */
export async function reserveAssistant(
  db: Db,
  actorId: string,
  sessionId: string,
  requestId: string,
) {
  const embedTicket = crypto.randomUUID(),
    generateTicket = crypto.randomUUID()
  const rows = await db.execute(sql`
    with personal as (
      insert into assistant_usage(actor_key, day, requests, last_started_at)
      select ${actorId}, (now() at time zone 'UTC')::date, 1, now()
      where not exists(select 1 from assistant_requests where id = ${requestId})
        and not exists(select 1 from assistant_sessions where id = ${sessionId}
          and (actor_id <> ${actorId} or turns >= ${ASSISTANT_LIMITS.turnsPerConversation}
            or created_at <= now() - interval '1 day'))
      on conflict(actor_key, day) do update
        set requests = assistant_usage.requests + 1, last_started_at = now()
        where assistant_usage.requests < ${ASSISTANT_LIMITS.messagesPerUserPerDay}
          and assistant_usage.last_started_at < now() - interval '10 seconds'
      returning requests
    ), global_usage as (
      insert into assistant_usage(actor_key, day, requests, last_started_at)
      select 'all', (now() at time zone 'UTC')::date, 1, now() from personal
      on conflict(actor_key, day) do update set requests = assistant_usage.requests + 1, last_started_at = now()
        where assistant_usage.requests < ${ASSISTANT_LIMITS.messagesPerDay}
      returning requests
    ), session as (
      insert into assistant_sessions(id, actor_id, turns)
      select ${sessionId}, ${actorId}, 1 from global_usage
      on conflict(id) do update set turns = assistant_sessions.turns + 1
        where assistant_sessions.actor_id = ${actorId}
          and assistant_sessions.turns < ${ASSISTANT_LIMITS.turnsPerConversation}
          and assistant_sessions.created_at > now() - interval '1 day'
      returning id, turns
    ), request as (
      insert into assistant_requests(id, session_id, actor_id, embed_ticket, generate_ticket, expires_at)
      select ${requestId}, id, ${actorId}, ${embedTicket}, ${generateTicket}, now() + interval '2 minutes'
      from session on conflict do nothing returning id
    )
    select session.turns, personal.requests as used from session, personal, request
  `)
  if (rows.rows.length === 1) {
    return {
      allowed: true as const,
      reason: null,
      retryAfterSeconds: null,
      embedTicket,
      generateTicket,
      turns: Number(rows.rows[0]?.turns ?? 0),
      used: Number(rows.rows[0]?.used ?? 0),
    }
  }
  const state = await db.execute(sql`
    select
      coalesce((select requests from assistant_usage where actor_key = ${actorId}
        and day = (now() at time zone 'UTC')::date), 0)::int as "personalRequests",
      coalesce((select requests from assistant_usage where actor_key = 'all'
        and day = (now() at time zone 'UTC')::date), 0)::int as "globalRequests",
      coalesce((select greatest(0, ceil(extract(epoch from
        (last_started_at + interval '10 seconds' - now())))) from assistant_usage
        where actor_key = ${actorId} and day = (now() at time zone 'UTC')::date), 0)::int
        as "retryAfterSeconds",
      (select actor_id::text from assistant_sessions where id = ${sessionId}) as "sessionActor",
      (select turns from assistant_sessions where id = ${sessionId})::int as "sessionTurns",
      (select created_at <= now() - interval '1 day' from assistant_sessions
        where id = ${sessionId}) as "sessionExpired"
  `)
  const limit = state.rows[0] as {
    personalRequests: number
    globalRequests: number
    retryAfterSeconds: number
    sessionActor: string | null
    sessionTurns: number | null
    sessionExpired: boolean | null
  }
  const reason =
    Number(limit.personalRequests) >= ASSISTANT_LIMITS.messagesPerUserPerDay
      ? ('daily' as const)
      : Number(limit.globalRequests) >= ASSISTANT_LIMITS.messagesPerDay
        ? ('global' as const)
        : Number(limit.retryAfterSeconds) > 0
          ? ('cooldown' as const)
          : limit.sessionActor !== null &&
              (limit.sessionActor !== actorId ||
                Number(limit.sessionTurns) >=
                  ASSISTANT_LIMITS.turnsPerConversation ||
                limit.sessionExpired)
            ? ('conversation' as const)
            : ('conflict' as const)
  return {
    allowed: false as const,
    reason,
    retryAfterSeconds:
      reason === 'cooldown' ? Number(limit.retryAfterSeconds) : null,
    embedTicket,
    generateTicket,
    turns: 0,
    used: Number(limit.personalRequests),
  }
}

function assistantLimitResponse(
  reason: Exclude<Awaited<ReturnType<typeof reserveAssistant>>['reason'], null>,
  retryAfterSeconds: number | null,
) {
  if (reason === 'cooldown')
    return {
      error: 'assistant_cooldown',
      message: `Please wait ${Math.max(1, retryAfterSeconds ?? 1)} seconds before sending another message. The cooldown also applies after starting a new conversation.`,
      retryAfterSeconds: Math.max(1, retryAfterSeconds ?? 1),
    }
  if (reason === 'daily')
    return {
      error: 'assistant_daily_limit',
      message:
        'Your daily assistant allowance has been used. It resets at midnight UTC.',
    }
  if (reason === 'global')
    return {
      error: 'assistant_global_limit',
      message:
        'The assistant has reached its shared daily allowance. It resets at midnight UTC.',
    }
  if (reason === 'conversation')
    return {
      error: 'assistant_conversation_limit',
      message:
        'This conversation has reached its turn limit. Start a new conversation to continue.',
    }
  return {
    error: 'assistant_limit',
    message:
      'This message could not be reserved. Please try again with a new conversation.',
  }
}

export function assistantRoutes(requireAuth: MiddlewareHandler<AppContext>) {
  const app = new Hono<AppContext>()
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store')
    await next()
  })
  app.use('*', requireAuth)
  app.get('/limits', async (c) => {
    const db = createDb(c.env.DATABASE_URL)
    const usage = await db.execute(sql`select requests from assistant_usage
      where actor_key = ${c.get('profile').id} and day = (now() at time zone 'UTC')::date`)
    const accessAllowed = assistantAccessAllowed(
      c.get('identity').email,
      c.env.ASSISTANT_ACCESS_MODE,
      c.env.ASSISTANT_PILOT_EMAILS,
    )
    return c.json({
      limits: ASSISTANT_LIMITS,
      enabled: Boolean(
        c.env.ASSISTANT_SERVICE_URL &&
        c.env.ASSISTANT_SERVICE_ACCOUNT &&
        c.env.ASSISTANT_SERVICE_AUDIENCE &&
        accessAllowed,
      ),
      accessMode: c.env.ASSISTANT_ACCESS_MODE ?? 'pilot',
      requiresAdultConfirmation:
        c.env.ASSISTANT_ACCESS_MODE === 'all_authenticated',
      pilotEligible: assistantPilotAllowed(
        c.get('identity').email,
        c.env.ASSISTANT_PILOT_EMAILS,
      ),
      used: Number(usage.rows[0]?.requests ?? 0),
    })
  })
  app.post(
    '/messages',
    bodyLimit({ maxSize: 40_000 }),
    zValidator('json', requestSchema),
    async (c) => {
      if (
        !assistantAccessAllowed(
          c.get('identity').email,
          c.env.ASSISTANT_ACCESS_MODE,
          c.env.ASSISTANT_PILOT_EMAILS,
        )
      ) {
        return c.json({ error: 'assistant_pilot_only' }, 403)
      }
      const origin = c.env.ASSISTANT_SERVICE_URL
      if (
        !origin ||
        !c.env.ASSISTANT_SERVICE_ACCOUNT ||
        !c.env.ASSISTANT_SERVICE_AUDIENCE
      ) {
        return c.json({ error: 'assistant_unavailable' }, 503)
      }
      try {
        assistantEndpoint(origin, 'generate')
      } catch {
        return c.json({ error: 'assistant_unavailable' }, 503)
      }
      const body = c.req.valid('json'),
        profile = c.get('profile'),
        db = createDb(c.env.DATABASE_URL)
      if (
        c.env.ASSISTANT_ACCESS_MODE === 'all_authenticated' &&
        body.adultConfirmed !== true
      ) {
        return c.json(
          {
            error: 'adult_confirmation_required',
            message:
              'Confirm that you are 18 or older before using the assistant.',
          },
          400,
        )
      }
      const reservation = await reserveAssistant(
        db,
        profile.id,
        body.sessionId,
        body.requestId,
      )
      if (!reservation.allowed) {
        // Do not invalidate a live request when a duplicate ID is replayed.
        await db.execute(sql`update assistant_requests set status = 'denied'
        where id = ${body.requestId} and embed_ticket = ${reservation.embedTicket}`)
        return c.json(
          assistantLimitResponse(
            reservation.reason,
            reservation.retryAfterSeconds,
          ),
          429,
        )
      }
      let status = 'unavailable'
      try {
        const productionRetrieval =
          c.env.ASSISTANT_RETRIEVAL_DAILY_REQUEST_LIMIT
        const quota = await consumeQuota(
          db,
          productionRetrieval ? 'assistant_retrieval_global' : 'dev_global',
          'all',
          1,
          1,
          productionRetrieval
            ? interactiveLimits(productionRetrieval, 300)
            : embeddingLimits(
                c.env.EMBEDDING_DAILY_REQUEST_LIMIT,
                c.env.EMBEDDING_DAILY_INPUT_LIMIT,
              ),
        )
        let repositoryStatus: 'searched' | 'retrieval_unavailable' = 'searched'
        let evidence: AssistantEvidence[] = []
        if (quota.allowed) {
          const raw = await regionalCall(
            db,
            origin,
            body.requestId,
            reservation.embedTicket,
            'embed',
            { query: buildAssistantRetrievalQuery(body.prompt, body.history) },
          )
          const parsed = z
            .object({
              values: z.array(z.number().finite()).length(EMBEDDING_DIMS),
            })
            .parse(raw)
          if (!parsed.values.some((v) => v !== 0))
            throw new Error('Zero vector')
          evidence = await retrieveAssistantEvidence(
            db,
            viewerRoleFor(profile.role),
            normalizeVector(parsed.values),
            {
              limit: ASSISTANT_LIMITS.evidenceChunks,
              keywordQuery: body.prompt,
            },
          )
        } else {
          repositoryStatus = 'retrieval_unavailable'
        }
        const base = {
          sessionId: body.sessionId,
          turns: reservation.turns,
          used: reservation.used,
          repositoryStatus,
        }
        if (evidence.length && !(await evidenceStillPublic(db, evidence)))
          throw new Error('Evidence changed')
        const sources = evidence.map((item, i) => ({
          id: `S${i + 1}`,
          recordId: item.recordId,
          title: item.title,
          year: item.year,
          bibliography: {
            authors: item.authors,
            repositoryAcceptanceYear: item.year,
            // SULUAN policy 2026-10-11: repository (acceptance) year serves
            // as the citation publication year; all 182 staging records are 2026.
            publicationYear: item.year,
          },
          excerpt: item.content.slice(0, 2000),
          matchType: item.matchType,
        }))
        const generated = await regionalCall(
          db,
          origin,
          body.requestId,
          reservation.generateTicket,
          'generate',
          {
            prompt: body.prompt,
            history: body.history,
            retrievalStatus: repositoryStatus,
            evidence: sources.map((s) => ({
              id: s.id,
              title: s.title,
              content: s.excerpt,
              bibliography: s.bibliography,
              matchType: s.matchType,
            })),
          },
        )
        const answer = validateAnswer(
          generated,
          sources.map((s) => s.id),
        )
        if (evidence.length && !(await evidenceStillPublic(db, evidence)))
          throw new Error('Evidence changed')
        status = answer.mode
        const cited = new Set(answer.paragraphs.flatMap((p) => p.citations))
        const visibleSources =
          answer.mode === 'general_guidance'
            ? sources.filter((source) => source.matchType !== 'semantic')
            : answer.mode === 'clarification'
              ? []
              : sources.filter((source) => cited.has(source.id))
        return c.json({
          ...base,
          ...answer,
          sources: visibleSources,
        })
      } catch {
        // No provider bodies, prompts, history, or evidence in logs/errors.
        return c.json({ error: 'assistant_unavailable' }, 503)
      } finally {
        await db.execute(sql`update assistant_requests set status = ${status},
        embed_hash = null, generate_hash = null,
        embed_used_at = coalesce(embed_used_at, now()), generate_used_at = coalesce(generate_used_at, now())
        where id = ${body.requestId} and actor_id = ${profile.id}`)
      }
    },
  )
  return app
}
