# Build and acceptance checklist

## Implemented

- [x] One shared workspace login, first-owner setup, hashed sessions, profile switching, role checks, team profiles, and workspace settings.
- [x] Database-backed dashboard, project workspaces, project-scoped task board/list, subtasks, comments, project discussion, calendar, activity, notifications, and global search.
- [x] Direct and group chat with authenticated Socket.IO, persisted history, read indicators, reconnect handling, retry deduplication, and a polling fallback in Next.js development mode.
- [x] Project-scoped file uploads, persistent local storage, validated uploads, private downloads, and project-aware search. Files can only be opened from their project workspace.
- [x] Responsive app shell, light/dark theme, migration history, Dockerfile, Compose configuration, health endpoint, and backup instructions. New installs start without sample records.

## Verified in this workspace

- [x] `npm run typecheck`.
- [x] `npm run lint`.
- [x] `npm test`: 6 unit tests passed.
- [x] `npm audit --audit-level=moderate`: 0 vulnerabilities.
- [x] `npm run build`.
- [x] Earlier local PostgreSQL checks covered the shared login, project membership, task comments, authenticated Socket.IO delivery, and retry deduplication.
- [x] Project records and shared file bytes remained available after restarting the app server.
- [x] Development server smoke check and mobile-width chat layout.

## Environment-dependent checks still needed

- [ ] Run `docker compose up -d --build` on a host with Docker installed and verify its health check and persistent volumes.
- [ ] Configure Cloudflare Tunnel or Tailscale on the owner's laptop and test from a separate device. Remote access is documented but is not configured or active.
- [ ] Test first-owner setup against a fresh database and run a dedicated automated end-to-end browser suite; this workspace has unit tests plus manual integration checks, not a full browser test suite.
