# Progress Log

## 2026-01-10 (Day N) — Dev env + Backend skeleton + Docker install (in progress)

### Done
- Initialized Git repo in D:\work\pet
- Configured git author (name/email)
- Created GitHub repo and pushed main
- Set up backend project (Node.js + TypeScript + Fastify)
- Fixed ESM/CommonJS issues by using `"type": "module"` in backend/package.json
- Added /health endpoint and confirmed server runs on port 3000
- Committed and pushed working backend skeleton

### In progress
- Installing Docker Desktop (via winget / Microsoft Store due to blocked docker.com)

### Next
- Run Postgres via docker-compose
- Add Prisma + schema (Animal, Clinic, MedicalEvent)
- Migrate DB
- Implement endpoints: /ingest/animal, /ingest/event, /animals/:id/timeline, /animals/:id/vaccinations
