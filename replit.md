# GrowthStack Content Pipeline

## Overview

A content repurposing pipeline for the GrowthStack podcast. Takes episode transcripts and clip transcripts and runs them through a 3-agent AI pipeline (Analyst, Writer, Editor) to produce platform-specific content packages.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui
- **AI**: Anthropic Claude (via Replit AI Integrations)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle for API server)

## Architecture

### Pipeline Flow
1. User submits episode transcript (episode-level) or episode + clip transcript (clip-level)
2. **Analyst Agent** (claude-sonnet-4-6): Produces editorial briefs, chapter timestamps, clip surgery recommendations
3. **Writer Agent** (claude-sonnet-4-6): Produces platform-specific outputs (Substack articles, LinkedIn posts, Twitter posts, YouTube titles/tags, Instagram hashtags)
4. **Editor Agent** (claude-sonnet-4-6): Final quality gate, catches style violations and content issues
5. User reviews outputs, provides feedback (triggers Editor revision), and approves

### Input Types
- **Episode-level**: Full transcript → Substack article + note + chapter timestamps
- **Clip-level (vertical)**: Full transcript + clip → YouTube Shorts title/tags + Instagram hashtags
- **Clip-level (horizontal)**: Full transcript + clip → LinkedIn post (Arnav's voice) + Twitter post (GrowthStack brand)

### YouTube Shorts Intelligence (Clip Runs)
For clip-type pipeline runs, before the Analyst call the backend:
1. Extracts topic keywords from the clip transcript (`extractTopicKeywords`)
2. Searches YouTube for top-performing Shorts on that topic (`searchYouTubeShorts`)
3. Formats the results as structured text and prepends it to the Analyst's input
4. Stores the raw JSON in the `youtube_data` column so the frontend can display it

The Brief (Analyst) tab in RunDetail shows YouTube Shorts cards (thumbnail, title, views, likes, tags) above the Analyst text for clip runs where YouTube data was found.

Env var required: `YOUTUBE_API_KEY` (stored as shared env var)

### Key Files
- `artifacts/api-server/src/lib/pipeline/prompts.ts` — Agent system prompts
- `artifacts/api-server/src/lib/pipeline/orchestrator.ts` — Pipeline orchestration logic
- `artifacts/api-server/src/lib/pipeline/youtube.ts` — YouTube Shorts search + formatting utilities
- `artifacts/api-server/src/routes/pipeline/index.ts` — API routes
- `lib/db/src/schema/pipeline-runs.ts` — Database schema
- `artifacts/growthstack/` — React frontend

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## API Endpoints

- `GET /api/pipeline/dashboard` — Dashboard summary stats
- `GET /api/pipeline/runs` — List all pipeline runs
- `POST /api/pipeline/runs` — Create and start a new pipeline run
- `GET /api/pipeline/runs/:id` — Get pipeline run detail with outputs
- `DELETE /api/pipeline/runs/:id` — Delete a pipeline run
- `GET /api/pipeline/runs/:id/stream` — SSE stream of pipeline progress
- `POST /api/pipeline/runs/:id/feedback` — Submit feedback for Editor revision (SSE)
- `POST /api/pipeline/runs/:id/approve` — Approve the final package

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
