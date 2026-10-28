# ADR 0003: Website on Next.js with Fumadocs, hosted on Vercel

**Status:** accepted · 2026-10-28

The website started on Astro + Starlight with a Node server on a self-managed droplet. We moved it to Next.js (App Router) with Fumadocs for the docs, deployed on Vercel, along with the playground.

- **Same stack as the SDK.** `@cutiva/react` is React, so the landing and docs can embed live SDK demos (the real `<Timeline>`) without an islands bridge.
- **Fumadocs** gives the docs search, table of contents and MDX components comparable to Starlight. Content stays as MDX in `apps/website/content/docs`.
- **Vercel** gives a preview per pull request and no server to maintain. The landing and docs are prerendered; only `/api/waitlist` and `/api/search` run as functions. The MongoDB client lives in module scope so warm invocations reuse the connection.
- The landing keeps its plain CSS in its own root layout; Tailwind (required by Fumadocs) only loads under `/docs`.

Trade-off: Next ships more JavaScript than Astro for mostly static pages. Acceptable for a marketing site, and it buys the shared React stack. Fumadocs requires React ≥ 19.2, so the whole monorepo moved to React 19.3.
