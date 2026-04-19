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

### Episode Layer (Primary Workflow)
Episodes are the top-level unit. Users paste a transcript once per episode, then run multiple clip analyses against it.

1. **Create Episode** (`POST /api/episodes`) — Title, guest name, transcript, episode link, subscribe URL
2. **Run Clip Analysis** (`POST /api/episodes/:id/clip`) — Vertical or horizontal orientation; uses episode transcript automatically
3. **Generate Full Episode Content** (`POST /api/episodes/:id/full-episode`) — Full pipeline: Substack article + note + social posts (SSE stream)
4. **View Workspace** (`/episodes/:id`) — Top bar with clip count, Previous Clip Analyses list, Full Episode Content panel

Each clip run creates a `pipeline_run` record with `episode_id` set. Episode cards on the dashboard link to the workspace.

### Pipeline Flow
1. Clip/episode input submitted
2. **Analyst Agent** (claude-sonnet-4-6): Editorial briefs, chapter timestamps, clip surgery recommendations
3. **Writer Agent** (claude-sonnet-4-6): Platform-specific outputs (Substack, LinkedIn, Twitter, YouTube, Instagram)
4. **Editor Agent** (claude-sonnet-4-6): Quality gate, style violation detection
5. User reviews outputs, provides feedback (triggers Editor revision), and approves

### Input Types
- **Episode-level (Full)**: Full transcript → Substack article + note + chapter timestamps
- **Clip-level (vertical)**: Episode transcript + clip → YouTube Shorts title/tags + Instagram hashtags
- **Clip-level (horizontal)**: Episode transcript + clip → LinkedIn post (Arnav's voice) + Twitter post (GrowthStack brand)

### YouTube Shorts Intelligence (Clip Runs)
For clip-type pipeline runs, before the Analyst call the backend:
1. Extracts topic keywords from the clip transcript (`extractTopicKeywords`)
2. Searches YouTube for top-performing Shorts on that topic (`searchYouTubeShorts`)
3. Formats the results as structured text and prepends it to the Analyst's input
4. Stores the raw JSON in the `youtube_data` column so the frontend can display it

Env var required: `YOUTUBE_API_KEY` (stored as shared env var)

### Key Files
- `artifacts/api-server/src/lib/pipeline/prompts.ts` — Agent system prompts
- `artifacts/api-server/src/lib/pipeline/orchestrator.ts` — Pipeline orchestration logic
- `artifacts/api-server/src/lib/pipeline/youtube.ts` — YouTube Shorts search + formatting utilities
- `artifacts/api-server/src/routes/pipeline/index.ts` — Pipeline run API routes
- `artifacts/api-server/src/routes/episodes/index.ts` — Episode CRUD + clip + full-episode routes
- `lib/db/src/schema/pipeline-runs.ts` — pipeline_runs table (includes episodeId FK)
- `lib/db/src/schema/episodes.ts` — episodes table (title, guest, transcript, substackArticle, clipCount, status)
- `artifacts/growthstack/src/pages/Dashboard.tsx` — Episode cards + Legacy Runs
- `artifacts/growthstack/src/pages/EpisodeWorkspace.tsx` — Episode workspace (all clip runs + full content)
- `artifacts/growthstack/src/pages/NewEpisode.tsx` — Create episode form
- `artifacts/growthstack/src/pages/RunDetail.tsx` — Single pipeline run detail (back-to-episode aware)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## API Endpoints

### Pipeline Runs
- `GET /api/pipeline/runs` — List all pipeline runs (includes episodeId)
- `POST /api/pipeline/runs` — Create and start a pipeline run (legacy; episode path preferred)
- `GET /api/pipeline/runs/:id` — Get run detail with outputs
- `DELETE /api/pipeline/runs/:id` — Delete a run
- `GET /api/pipeline/runs/:id/stream` — SSE stream of pipeline progress
- `POST /api/pipeline/runs/:id/feedback` — Submit feedback for Editor revision (SSE)
- `POST /api/pipeline/runs/:id/approve` — Approve the final package

### Episodes
- `GET /api/episodes` — List all episodes with clip counts and latest run
- `POST /api/episodes` — Create a new episode
- `GET /api/episodes/:id` — Get episode with all associated clip runs
- `PATCH /api/episodes/:id` — Update episode (transcript, status, etc.)
- `DELETE /api/episodes/:id` — Delete episode (cascades to runs)
- `POST /api/episodes/:id/clip` — Start a clip analysis run for this episode
- `POST /api/episodes/:id/full-episode` — Generate full episode content package (SSE)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
