# Appraisal Portal Monorepo

Local development monorepo scaffold based on the repository system specifications.

## Workspace Structure

- `apps/web` - React + Vite + Tailwind frontend
- `apps/api` - Node.js + Express backend
- `packages/database` - Prisma schema/client package
- `packages/shared` - Shared TypeScript types

## Quick Start

1. Copy env file:

```bash
cp .env.example .env
```

2. Start PostgreSQL:

```bash
npm run docker:up
```

3. Install dependencies and generate Prisma client:

```bash
npm install
npm run prisma:generate
```

4. Run migrations:

```bash
npm run prisma:migrate:dev -- --name init
```

5. Start API + Web:

```bash
npm run dev
```

## Default Local URLs

- API: `http://localhost:3001`
- Web: `http://localhost:5173`
