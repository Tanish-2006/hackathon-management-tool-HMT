# AI Helper v2 — multi-agent ideation (Ideathon 2026)

Status: approved approach A (server-orchestrated specialists). Sub-project 1 of 2; sub-project 2 (single event "Ideathon 2026", preloaded shortlisted teams, email-only entry, removal of other events) gets its own spec.

## Intent
Shortlisted teams ideate with an AI coach, then present offline. The agents' only job is to ask sharp, honest, unbiased, idea-specific questions that make participants think — never to write the idea for them. Evidence (real papers, real competitors) is used to challenge claims. Participants can abuse the system; limits must stop abuse while ordinary teams never notice them.

## Scope
In: self-paced phases, router + 4 specialists, master agents (team + personal), real sources (papers + market search), deck text review (.pptx/.pdf), abuse protection with countdowns, new chat UI, organizer config of phases/instructions.
Out: organizer round control (removed — single round), slide image/design analysis (text only), deck generation (teams write their own slides), event access/preload (sub-project 2).

## Phases (self-paced, per thread)
1 Problem — one specific, painful, real problem in the words of those who have it.
2 Users — exactly who, what they do today, how the team knows.
3 Prior work — research and existing solutions.
4 Gap & solution — what is genuinely missing and why their idea fills it better.
5 Feasibility — can they build/validate it; riskiest assumption.
6 Pitch & deck — 60-second explanation, judge-proof answers, slide outline, uploaded deck review against phases 1–5.
The router decides advance (one step), stay, or revisit (to an earlier phase, with a reason). Participants cannot skip. Organizer can edit each phase's title/goal/questions/exit check and global extra instructions; no advance button.

## Message pipeline (per send)
1 Guard — limits (below), size, duplicate/flood checks → 429 `{retryAfter}`.
2 Router — one non-streamed ASI:One call, JSON only: `{ verdict: "stay"|"advance"|"revisit", revisitTo?: 1-5, specialist: "none"|"research"|"market"|"devil"|"users", query?: string, offTopic: boolean, reason: string }`. Invalid JSON → `{stay, none}`.
3 Specialist (only if requested) — research: Semantic Scholar + OpenAlex + arXiv (top 5 combined, deduped, title/year/venue/url/abstract snippet). market: Tavily search (top 5, title/url/snippet). devil/users: no fetch; a lens instruction for the master. Results cached in memory 6h by normalized query. Fetch timeout 8s per source; failures degrade to "no sources found", never block the reply.
4 Master — streamed ASI:One reply: honest questions about this team's idea, cites sources as [1]..[n] when present, at most ~3 questions per turn, no flattery, no writing the idea/slides for them. offTopic → short polite redirect, counts a strike.
5 Store — user message, optional card (specialist + sources), optional phase event, assistant message.

ASI:One calls per send: 2 (router + master). Both go through the existing capped queue with timeout.

## Deck review
Browser extracts text per slide (jszip for .pptx: slide titles/body + notes; pdf.js for .pdf: text per page), max 15 MB file, ≤ 60 slides, ≤ 24k chars total. POST text JSON; server stores a `deck` message (slide count + text) and the master reviews slide-by-slide against phases 1–5 (consistency, missing evidence, unclear/overclaimed statements, missing slides). Allowed in phase 6 only. Image-only slides are reported as "no text".

## Abuse protection (generous; only abuse hits it)
Per user: 1 send per 3 s; 20 sends/10 min; 120 sends/day per hackathon. Per thread: 60 sends/10 min. Deck reviews: 6/hour per thread. Market searches: 20/team/day; global Tavily cap 900/day (then market falls back to clearly-labelled model knowledge). Duplicate message within 60 s rejected. 3 off-topic strikes in 15 min → 5-minute cooldown for that user. Every limit returns 429 with `retryAfter` seconds and a human message; UI shows a live countdown and re-enables automatically.

## API (participant-api, prefix /api/v1)
GET `/ideation/:hid` → `{ hackathon:{id,title}, phases: Phase[6], extraInstructions, team, teamThread: Thread|null, personalThread: Thread, limits:{ maxChars:4000 } }`
Thread = `{ id, phase: 1-6, phaseHistory:[{phase,at,reason}], messages: Msg[] }`
Msg = `{ id, kind:"user"|"assistant"|"card"|"phase"|"deck"|"notice", role, content, authorId, authorName, phase, createdAt, card?:{specialist, title, sources:[{title,url,meta}]}, phaseChange?:{from,to,reason}, deck?:{fileName, slideCount} }`
POST `/ideation/:hid/messages` `{scope, content}` → SSE: `start{phase}` · `stage{name:"routing"|"research"|"market"|"devil"|"users"|"writing"}` · `card{...}` · `phase{from,to,reason}` · `delta{text}` · `done{userMessageId, assistantMessageId, phase}` · `error{message, retryAfter?}`. Limit violations before streaming → HTTP 429 JSON `{message, retryAfter}`.
POST `/ideation/:hid/deck` `{scope, fileName, slides:[{index,title,text}]}` → same SSE stream (stages: "reading","writing").

## UI (participant AI Helper)
Header: event title, 6-step phase progress (done ✓ / current / locked), current phase goal + "what the coach is checking". Tabs: Team · Personal. Chat: user bubbles (author initials + name), assistant bubbles (light markdown: paragraphs, bullets, bold, [n] citation links), specialist cards (icon + name, collapsible sources with links), phase banners (advance 🎉 / revisit ↩ with reason), deck messages (file chip + slide count). Live stage indicator while streaming ("Research Scout is searching papers…"). Composer: auto-grow textarea, Enter send / Shift+Enter newline, char counter, disabled while streaming, countdown on 429, deck upload button in phase 6. Auto-scroll with "jump to latest". Works at 360 px. Accessible labels on all controls.

## Errors
ASI busy/timeout → stream `error` with friendly message; user message kept. Source APIs down → reply proceeds without sources. Router failure → stay/none. Extraction failure in browser → inline error, nothing sent.

## Testing
Jest: router JSON parsing/fallbacks, guard limits and retryAfter, phase transitions, source fetchers (mocked fetch), cache, prompt rules. Vitest: organizer phase config validation. Playwright (local, real ASI:One + Tavily, small volume): team chat through phases with research card, personal thread privacy, rate-limit countdown, deck upload (.pptx and .pdf fixtures) review, mobile 360 px, no console errors.
