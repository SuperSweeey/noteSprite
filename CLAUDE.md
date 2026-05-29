# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**OpenNote AI (Noteflow)** — an open-source, self-hostable, AI-native personal knowledge management system. v0.1 MVP in progress.

Core pitch: capture thoughts + collect external info (web, PDF, images, audio, video) → convert to Markdown → AI summarizes/tags/classifies → organize via flomo-style `#a/b/c` hierarchical tags + knowledge bases → daily spaced-repetition review.

## Tech Stack & Commands

- **Full-stack**: Next.js 14 (App Router) + TypeScript
- **Database**: SQLite via Prisma (swap to PostgreSQL in production)
- **Styling**: Tailwind CSS
- **AI**: DeepSeek API (OpenAI-compatible), pluggable via user settings
- **Transcription**: Python pipeline (`python/main.py`) for Douyin/Bilibili/YouTube/小红书

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run db:push      # Push Prisma schema to SQLite
npm run db:studio    # Open Prisma Studio (visual DB browser)
npm run db:migrate   # Create a migration after schema changes
npm run db:seed      # Run prisma/seed.ts
```

### Environment variables

Copy `.env.example` to `.env`:
- `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` — AI features
- `COS_SECRET_ID` / `COS_SECRET_KEY` / `COS_BUCKET` / `COS_REGION` — Tencent COS for file uploads (optional)
- `DASHSCOPE_API_KEY` / `OSS_*` / `FFMPEG_PATH` — Python transcription pipeline (optional)

## Architecture

### Page → Component tree

```
layout.tsx (RootLayout)
├── page.tsx (Home) — Sidebar + MainWorkspace + SpiritPanel
├── inbox/page.tsx — Sidebar + inbox list + SpiritPanel
├── note/[id]/page.tsx — Sidebar + note detail (tabs) + SpiritPanel
└── ai/page.tsx — Sidebar + full chat UI + SpiritPanel
```

**MainWorkspace** (`src/components/MainWorkspace.tsx`) is the core page. It has two modes:
- **写想法 (write)** — flomo-style textarea, Ctrl+Enter to save, inline `#a/b/c` tag parsing
- **丢链接 (link)** — paste a URL → POST `/api/transcribe` → Python pipeline → AI summary

**SpiritPanel** (`src/components/SpiritPanel.tsx`) — right-side chat panel ("笔记精灵"). Per-note or global context. Chat history is persisted in `ChatMessage` table. Shows proactive prompts every 5-10 minutes.

**Note detail** (`src/app/note/[id]/page.tsx`) has 4 tabs: 精灵的话 (AI report), 笔记正文 (Markdown viewer/editor), 出处 (source), 续写 (append).

### API routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET/POST | `/api/notes` | List notes (with tag/search/status filters) / Create note |
| PATCH/DELETE | `/api/notes/[id]` | Update note (content, status) / Soft delete |
| GET | `/api/tags` | List all user tags |
| GET/POST/DELETE | `/api/ai/chat` | Chat history / Send message / Clear history |
| POST | `/api/ai/report` | Generate AI report for a note |
| PUT | `/api/ai/report` | Save edited report |
| POST | `/api/ai/test` | Test AI connection from settings |
| POST | `/api/transcribe` | Submit URL for transcription (runs Python pipeline) |

### Key lib modules

- **`lib/prisma.ts`** — Prisma singleton (globalThis pattern for dev)
- **`lib/auth.ts`** — Dev-only auth: upserts a `dev@noteflow.local` user, returns userId. Replace with NextAuth before production.
- **`lib/ai.ts`** — `analyzeNote(content)` → calls DeepSeek, returns `AIAnalysis` (title, summary, keyPoints, keywords, suggestedTags, actionItems, reviewQuestions). Returns null if no API key.
- **`lib/tags.ts`** — `parseTags(text)` regex extraction, `expandTagHierarchy(fullPath)` for all ancestor paths, `stripMarkdown(md)` for plain text extraction
- **`lib/tags-db.ts`** — `ensureTagHierarchy(userId, fullPath)` — creates tag + all ancestors in DB, returns all tag IDs
- **`lib/transcribe.ts`** — `detectPlatform(url)`, `transcribeUrl(url)` — shells out to Python `python/main.py`, reads transcript from `python/output/transcripts/`
- **`lib/cos.ts`** — Tencent COS client singleton, presigned upload URLs, file read URLs with optional CDN domain

### Tag system design

Tags follow flomo's `#a/b/c` pattern. They are parsed from note body via regex (`/#[\w一-鿿-]+(\/[w一-鿿-]+)*/g`), not manually pre-registered. When a note is saved:
1. `parseTags()` extracts tag paths from the Markdown content
2. `ensureTagHierarchy()` creates all ancestor tags in DB (e.g., `#产品/AI笔记/定位` creates `产品`, `产品/AI笔记`, `产品/AI笔记/定位`)
3. All tag IDs (ancestors + leaf) are linked to the note via `NoteTag` junction table
4. `expandTagHierarchy()` is used for filtering — querying `#产品` returns all notes under `#产品/*`

### Transcription flow (丢链接)

```
User pastes URL → POST /api/transcribe → creates note with type="link", status="processing"
  → Background: runTranscription()
    → detectPlatform(url) — supports douyin, bilibili, youtube, xiaohongshu
    → exec python/main.py --platform X --url Y
    → Read transcript from python/output/transcripts/transcript_{taskId}.txt
    → Generate AI title + run AI analysis
    → Update note with full transcription as Markdown
    → On failure: mark note with error message
```

### User settings (persistence)

AI model/key/baseURL are stored client-side in `localStorage` (keys: `nf_model`, `nf_api_key`, `nf_base_url`, `nf_prompt`). The Sidebar's settings modal reads/writes these. The SpiritPanel and AI chat page read them on each request and pass them to the API, where they override server-side env vars.

## Key Design Decisions

- **Markdown is the core content format**, not just export. Every note's canonical form is Markdown.
- **Tags follow flomo's `#a/b/c` pattern** — inline in note body, auto-parsed. Parent tags aggregate children.
- **AI is advisory, not autonomous.** AI suggests titles, summaries, tags, knowledge base placement — user confirms. AI analysis runs async after note creation (fire-and-forget).
- **Review is embedded in Note** — reviewStatus, nextReviewAt, reviewCount, mastery fields on the Note model, not a separate table.
- **Sync model**: SyncCursor + ChangeLog tables exist in schema but are not yet wired up to API endpoints (v0.1 foundation).
- **Chat persists**: All SpiritPanel conversations are saved to ChatMessage table, loaded by noteId or globally.

## AI System

Two AI functions, not four:

| | 单篇分析 | 精灵对话 |
|---|---|---|
| **作用** | 对一条笔记提取标题/摘要/要点/标签/复习问题 | 基于全部笔记的对话 — **这就是知识库 AI** |
| **触发** | 创建笔记时、丢链接转录后（同一套 `analyzeNote()`） | 右侧 SpiritPanel、全屏 `/ai` 页、详情页 "精灵的话" |
| **API** | 无独立端点，fire-and-forget 在 notes/transcribe 流程中 | `/api/ai/chat`（对话）、`/api/ai/report`（展读报告） |

**精灵对话就是知识库 AI**。精灵的上下文包含最近 20 条笔记 + 对话历史，用户可以通过对话检索、梳理、总结自己的知识。

**转录辅助不是独立系统**。转录后的标题生成和内容分析就是调了 `analyzeNote()`，属于单篇分析。

### User AI settings (完全自由度)

用户在侧边栏 ⚙ 偏好设置中可配置：模型、接口地址、密钥、System Prompt。所有配置保存在 `localStorage`（`nf_model` / `nf_api_key` / `nf_base_url` / `nf_prompt`）。

- **精灵对话** — SpiritPanel 和 `/ai` 页将设置传给 `/api/ai/chat`，覆盖服务端 env 默认值
- **精灵展读** — 笔记详情页将设置传给 `/api/ai/report`，覆盖服务端 env 默认值
- **单篇分析** — 运行在服务端 fire-and-forget 流程中，使用服务端 env 变量（不经过客户端设置）

## v0.1 MVP Scope

Eight capabilities forming the minimum viable loop:
1. Web quick-capture (open-and-write, like flomo)
2. Markdown edit + save + preview
3. `#a/b/c` hierarchical tag parsing, display, filtering
4. Inbox — all new content lands here by default, then gets sorted
5. Basic knowledge bases with folder structure
6. AI auto title, summary, keyword extraction, tag suggestion
7. Server-side sync basics (web ↔ server)
8. Markdown export

Intentionally deferred: mobile app, video/audio processing, complex knowledge graph, real-time collaboration, plugin marketplace.