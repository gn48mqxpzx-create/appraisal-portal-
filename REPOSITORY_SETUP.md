# Repository Setup Guide
## Salary Appraisal Workflow System

### Version: 1.0
### Date: February 26, 2026

---

## Prerequisites

Before setting up the repository, ensure you have:

- **Node.js** 18+ and npm 9+
- **Git** 2.30+
- **PostgreSQL** 14+ (or Docker for local development)
- **GitHub** account with write access
- **Code Editor** (VS Code recommended)

---

## Step 1: Create Local Repository Structure

### 1.1 Create Root Directory

```bash
mkdir salary-appraisal-system
cd salary-appraisal-system
```

### 1.2 Initialize Git Repository

```bash
git init
```

### 1.3 Create Directory Structure

```bash
# Create main directories
mkdir -p apps/web/src apps/api/src packages/database packages/shared docs scripts

# Create web app subdirectories
mkdir -p apps/web/src/{components,pages,hooks,services,contexts,utils,types}
mkdir -p apps/web/src/components/{common,layout,cases,cycles,uploads,approvals,dashboard,admin}
mkdir -p apps/web/src/pages/admin
mkdir -p apps/web/public

# Create API subdirectories
mkdir -p apps/api/src/{controllers,services,middleware,validators,utils,config,routes,types}
mkdir -p apps/api/src/validators/schemas
mkdir -p apps/api/prisma/{migrations}
mkdir -p apps/api/tests/{unit,integration}

# Create package subdirectories
mkdir -p packages/database/src
mkdir -p packages/shared/src/{types,constants}
```

---

## Step 2: Create Root Configuration Files

### 2.1 Create .gitignore

```bash
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
/.pnp
.pnp.js

# Testing
/coverage

# Production
build/
dist/
apps/*/dist
apps/*/build

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*
logs/
*.log

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db
ehthumbs.db
Desktop.ini

# Uploads and storage
apps/api/uploads/
apps/api/storage/
uploads/
storage/

# Database
*.db
*.sqlite
*.sqlite3

# Prisma
apps/api/prisma/migrations/*_migration/
.env.prisma

# Build artifacts
*.tsbuildinfo

# Temporary files
tmp/
temp/
.temp/
EOF
```

### 2.2 Create .env.example

```bash
cat > .env.example << 'EOF'
# ============================================================================
# DATABASE
# ============================================================================
DATABASE_URL="postgresql://appraisal_user:password@localhost:5432/salary_appraisal?schema=public"

# ============================================================================
# API SERVER
# ============================================================================
NODE_ENV="development"
API_PORT=3001
API_BASE_URL="http://localhost:3001"
FRONTEND_URL="http://localhost:3000"

# ============================================================================
# JWT & AUTHENTICATION
# ============================================================================
JWT_SECRET="your-jwt-secret-change-in-production-min-32-chars"
JWT_EXPIRY="15m"
REFRESH_TOKEN_SECRET="your-refresh-token-secret-change-in-production-min-32-chars"
REFRESH_TOKEN_EXPIRY="7d"

# ============================================================================
# OTP CONFIGURATION
# ============================================================================
OTP_EXPIRY_MINUTES=10
OTP_MAX_ATTEMPTS=5

# ============================================================================
# EMAIL SERVICE (SendGrid)
# ============================================================================
SENDGRID_API_KEY="SG.your-sendgrid-api-key"
EMAIL_FROM="noreply@yourcompany.com"
EMAIL_FROM_NAME="Salary Appraisal System"

# Alternative: AWS SES
# AWS_REGION="us-east-1"
# AWS_ACCESS_KEY_ID="your-access-key"
# AWS_SECRET_ACCESS_KEY="your-secret-key"
# SES_FROM_EMAIL="noreply@yourcompany.com"

# ============================================================================
# FILE STORAGE
# ============================================================================
STORAGE_TYPE="local"  # "local" or "s3"
LOCAL_STORAGE_PATH="./uploads"

# S3 Configuration (if STORAGE_TYPE=s3)
# S3_BUCKET="salary-appraisal-uploads"
# S3_REGION="us-east-1"
# S3_ACCESS_KEY_ID="your-s3-access-key"
# S3_SECRET_ACCESS_KEY="your-s3-secret-key"
# S3_ENDPOINT="https://s3.amazonaws.com"  # Optional: for S3-compatible services

# ============================================================================
# RATE LIMITING
# ============================================================================
RATE_LIMIT_OTP_PER_EMAIL=5
RATE_LIMIT_OTP_PER_IP=10
RATE_LIMIT_WINDOW_HOURS=1
RATE_LIMIT_GLOBAL_PER_USER=1000
RATE_LIMIT_GLOBAL_WINDOW_MINUTES=15

# ============================================================================
# ADMIN SETTINGS
# ============================================================================
ALLOWED_EMAIL_DOMAINS="yourcompany.com"
GLOBAL_DEFAULT_CATCHUP_PERCENT=75

# ============================================================================
# REDIS (Optional - for session/cache)
# ============================================================================
REDIS_URL="redis://localhost:6379"
REDIS_PASSWORD=""
REDIS_DB=0

# ============================================================================
# LOGGING
# ============================================================================
LOG_LEVEL="info"  # debug, info, warn, error
LOG_FILE_ENABLED="true"
LOG_FILE_PATH="./logs/app.log"

# ============================================================================
# CORS
# ============================================================================
CORS_ORIGINS="http://localhost:3000,http://localhost:3001"

# ============================================================================
# SECURITY
# ============================================================================
BCRYPT_ROUNDS=10
SESSION_COOKIE_NAME="appraisal_session"
SESSION_COOKIE_SECURE="false"  # Set to "true" in production with HTTPS
SESSION_COOKIE_SAME_SITE="lax"

# ============================================================================
# UPLOADS
# ============================================================================
MAX_FILE_SIZE_MB=10
ALLOWED_FILE_TYPES="application/pdf"
ALLOWED_SPREADSHEET_TYPES="text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"

# ============================================================================
# FEATURE FLAGS
# ============================================================================
ENABLE_WEBHOOKS="false"
ENABLE_VIRUS_SCANNING="false"

EOF
```

### 2.3 Create docker-compose.yml

```bash
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:14-alpine
    container_name: appraisal-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: appraisal_user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: salary_appraisal
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U appraisal_user"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: appraisal-redis
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  default:
    name: appraisal-network
EOF
```

### 2.4 Create Root package.json (Workspace Configuration)

```bash
cat > package.json << 'EOF'
{
  "name": "salary-appraisal-system",
  "version": "1.0.0",
  "description": "Salary Appraisal Workflow and Compensation Processing System",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev:web": "npm run dev --workspace=apps/web",
    "dev:api": "npm run dev --workspace=apps/api",
    "dev": "concurrently \"npm run dev:api\" \"npm run dev:web\"",
    "build:web": "npm run build --workspace=apps/web",
    "build:api": "npm run build --workspace=apps/api",
    "build": "npm run build:api && npm run build:web",
    "test": "npm run test --workspaces",
    "lint": "npm run lint --workspaces",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\"",
    "prisma:generate": "npm run prisma:generate --workspace=apps/api",
    "prisma:migrate": "npm run prisma:migrate --workspace=apps/api",
    "prisma:migrate:deploy": "npm run prisma:migrate:deploy --workspace=apps/api",
    "prisma:studio": "npm run prisma:studio --workspace=apps/api",
    "seed": "npm run seed --workspace=apps/api",
    "docker:up": "docker-compose up -d",
    "docker:down": "docker-compose down",
    "docker:logs": "docker-compose logs -f"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "concurrently": "^8.2.0",
    "eslint": "^8.50.0",
    "prettier": "^3.0.3",
    "typescript": "^5.2.2"
  },
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=9.0.0"
  }
}
EOF
```

### 2.5 Create Root tsconfig.json

```bash
cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true
  }
}
EOF
```

### 2.6 Create .eslintrc.js

```bash
cat > .eslintrc.js << 'EOF'
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  env: {
    node: true,
    es6: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
EOF
```

### 2.7 Create .prettierrc

```bash
cat > .prettierrc << 'EOF'
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false
}
EOF
```

### 2.8 Create README.md

```bash
cat > README.md << 'EOF'
# Salary Appraisal Workflow and Compensation Processing System

Internal compensation appraisal workflow system managing the complete lifecycle from employee scope identification through market-based recommendations, multi-stage approvals, to payroll export.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL 14+ (or use Docker)
- npm 9+

### Initial Setup

1. **Clone repository** (after pushing to GitHub):
   ```bash
   git clone https://github.com/your-org/salary-appraisal-system.git
   cd salary-appraisal-system
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start database** (using Docker):
   ```bash
   npm run docker:up
   ```

5. **Run database migrations**:
   ```bash
   npm run prisma:migrate
   ```

6. **Seed initial data**:
   ```bash
   npm run seed
   ```

7. **Start development servers**:
   ```bash
   npm run dev
   ```

   - API: http://localhost:3001
   - Web: http://localhost:3000

## 📚 Documentation

- [System Design](docs/SYSTEM_DESIGN.md) - Complete architecture overview
- [Database Schema](docs/DATABASE_SCHEMA.md) - Prisma models and relationships
- [API Contracts](docs/API_CONTRACTS.md) - All endpoints with examples
- [UI Architecture](docs/UI_ARCHITECTURE.md) - Frontend structure and components
- [Setup Guide](docs/SETUP_GUIDE.md) - Detailed local development setup

## 🏗️ Project Structure

```
salary-appraisal-system/
├── apps/
│   ├── web/          # React frontend (Tailwind CSS)
│   └── api/          # Node.js backend (Express + Prisma)
├── packages/
│   ├── database/     # Shared Prisma client
│   └── shared/       # Shared types and utilities
├── docs/             # Documentation
└── scripts/          # Utility scripts
```

## 🛠️ Available Scripts

### Development
- `npm run dev` - Start both API and web in development mode
- `npm run dev:api` - Start API server only
- `npm run dev:web` - Start web app only

### Build
- `npm run build` - Build both applications
- `npm run build:api` - Build API only
- `npm run build:web` - Build web app only

### Database
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Create and apply migration
- `npm run prisma:studio` - Open Prisma Studio GUI
- `npm run seed` - Seed database with initial data

### Docker
- `npm run docker:up` - Start PostgreSQL and Redis
- `npm run docker:down` - Stop containers
- `npm run docker:logs` - View container logs

### Quality
- `npm run lint` - Run ESLint on all workspaces
- `npm run format` - Format code with Prettier
- `npm test` - Run all tests

## 🔐 Authentication

The system uses Google email OTP authentication:

1. User enters email address
2. System sends 6-digit code via email
3. User enters code to authenticate
4. Session created with JWT tokens

## 👥 User Roles

- **Admin** - Full system access
- **HR** - Manage cases, uploads, approvals
- **Finance** - Approve compensation, view reports
- **Payroll** - Export payroll data
- **Manager** - View and manage team appraisals
- **SM** (Success Manager) - Limited visibility
- **RM** (Relationship Manager) - Limited visibility

## 🔄 Workflow Overview

1. **Cycle Management** - Admin creates and activates cycles
2. **Data Import** - HR uploads employee scope data
3. **Compensation Entry** - HR/Manager enters current compensation
4. **Market Analysis** - System computes recommendations
5. **Approvals** - Collect client approval evidence
6. **Checklist** - Multi-role approval workflow
7. **Payroll Export** - Export approved data to payroll

## 🚢 Deployment

See [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) for production deployment instructions.

## 📝 License

Internal use only - Proprietary

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/my-feature`
2. Commit changes: `git commit -m 'feat(scope): description'`
3. Push to branch: `git push origin feature/my-feature`
4. Open Pull Request

### Commit Convention

```
type(scope): message

Types: feat, fix, docs, style, refactor, test, chore
```

## 📧 Support

For questions or issues, contact: tech-support@yourcompany.com
EOF
```

---

## Step 3: Initialize Git and Branches

### 3.1 Create Initial Commit

```bash
# Stage all files
git add .

# Create initial commit
git commit -m "chore: initial repository setup with monorepo structure

- Add root configuration (package.json, tsconfig, eslint, prettier)
- Add environment variables template
- Add docker-compose for local PostgreSQL and Redis
- Create directory structure for apps and packages
- Add comprehensive .gitignore
- Add README with quick start guide"
```

### 3.2 Create Branches

```bash
# Create develop branch
git checkout -b develop

# Return to main
git checkout main

# Verify branches
git branch
```

**Output should show**:
```
  develop
* main
```

---

## Step 4: Create GitHub Repository

### 4.1 Create Repository on GitHub

1. Go to https://github.com/new
2. **Repository name**: `salary-appraisal-system`
3. **Description**: "Salary Appraisal Workflow and Compensation Processing System"
4. **Visibility**: Private (recommended for internal tools)
5. **Do NOT initialize** with README, .gitignore, or license (we already have these)
6. Click **Create repository**

### 4.2 Add Remote and Push

GitHub will show you commands. For a new repository created locally, use:

```bash
# Add GitHub as remote origin
git remote add origin https://github.com/your-org/salary-appraisal-system.git

# Or using SSH (recommended):
git remote add origin git@github.com:your-org/salary-appraisal-system.git

# Verify remote
git remote -v

# Push main branch
git push -u origin main

# Push develop branch
git checkout develop
git push -u origin develop

# Set main as default branch on GitHub (via GitHub Settings > Branches)
```

### 4.3 Configure Branch Protection (Recommended)

On GitHub, go to **Settings > Branches** and add protection rules for `main`:

✅ Require pull request reviews before merging  
✅ Require status checks to pass before merging  
✅ Require branches to be up to date before merging  
✅ Include administrators (optional)

---

## Step 5: Install Dependencies

### 5.1 Install Root Dependencies

```bash
npm install
```

This installs workspace configuration and shared dev dependencies:
- TypeScript
- ESLint
- Prettier
- Concurrently (for running multiple dev servers)

---

## Step 6: Set Up API Application

### 6.1 Create API package.json

```bash
cat > apps/api/package.json << 'EOF'
{
  "name": "@salary-appraisal/api",
  "version": "1.0.0",
  "description": "API server for Salary Appraisal System",
  "main": "dist/server.js",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "jest",
    "test:watch": "jest --watch",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:migrate:deploy": "prisma migrate deploy",
    "prisma:studio": "prisma studio",
    "seed": "tsx prisma/seed.ts",
    "lint": "eslint src --ext .ts"
  },
  "dependencies": {
    "@prisma/client": "^5.5.0",
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "helmet": "^7.0.0",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "zod": "^3.22.0",
    "multer": "^1.4.5-lts.1",
    "express-rate-limit": "^7.0.0",
    "express-validator": "^7.0.1",
    "nodemailer": "^6.9.7",
    "@sendgrid/mail": "^8.1.0",
    "csv-parse": "^5.5.0",
    "csv-stringify": "^6.4.0",
    "exceljs": "^4.3.0",
    "date-fns": "^2.30.0",
    "uuid": "^9.0.1",
    "winston": "^3.11.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.20",
    "@types/cors": "^2.8.15",
    "@types/bcrypt": "^5.0.1",
    "@types/jsonwebtoken": "^9.0.4",
    "@types/multer": "^1.4.9",
    "@types/node": "^20.8.0",
    "@types/nodemailer": "^6.4.13",
    "@types/uuid": "^9.0.6",
    "prisma": "^5.5.0",
    "tsx": "^3.14.0",
    "jest": "^29.7.0",
    "@types/jest": "^29.5.6",
    "supertest": "^6.3.3",
    "@types/supertest": "^2.0.15"
  }
}
EOF
```

### 6.2 Create API tsconfig.json

```bash
cat > apps/api/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "commonjs",
    "target": "ES2020",
    "lib": ["ES2020"],
    "esModuleInterop": true,
    "strict": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
EOF
```

### 6.3 Create Prisma Schema

Copy the schema from DATABASE_SCHEMA.md into:

```bash
# Copy your Prisma schema here
nano apps/api/prisma/schema.prisma
```

---

## Step 7: Set Up Web Application

### 7.1 Create Web package.json

```bash
cat > apps/web/package.json << 'EOF'
{
  "name": "@salary-appraisal/web",
  "version": "1.0.0",
  "description": "React frontend for Salary Appraisal System",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .ts,.tsx"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.17.0",
    "react-hook-form": "^7.47.0",
    "@hookform/resolvers": "^3.3.2",
    "zod": "^3.22.0",
    "@tanstack/react-query": "^5.0.0",
    "@tanstack/react-table": "^8.10.0",
    "axios": "^1.5.1",
    "date-fns": "^2.30.0",
    "react-dropzone": "^14.2.3",
    "react-pdf": "^7.5.1",
    "recharts": "^2.9.0",
    "@headlessui/react": "^1.7.17",
    "@heroicons/react": "^2.0.18"
  },
  "devDependencies": {
    "@types/react": "^18.2.31",
    "@types/react-dom": "^18.2.14",
    "@vitejs/plugin-react": "^4.1.0",
    "vite": "^4.5.0",
    "typescript": "^5.2.2",
    "tailwindcss": "^3.3.5",
    "postcss": "^8.4.31",
    "autoprefixer": "^10.4.16",
    "eslint-plugin-react": "^7.33.2",
    "eslint-plugin-react-hooks": "^4.6.0"
  }
}
EOF
```

### 7.2 Create Web tsconfig.json

```bash
cat > apps/web/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
EOF
```

### 7.3 Create Vite Configuration

```bash
cat > apps/web/vite.config.ts << 'EOF'
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
EOF
```

### 7.4 Create Tailwind Configuration

```bash
cat > apps/web/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
EOF
```

---

## Step 8: Commit and Push Setup

```bash
# Add all new files
git add .

# Commit
git commit -m "feat: add application scaffolding

- Add API package configuration with Express and Prisma
- Add Web package configuration with React, Vite, and Tailwind
- Add Prisma schema with complete database models
- Configure TypeScript for both applications
- Add development scripts and tooling"

# Push to develop
git push origin develop
```

---

## Step 9: Verify Setup

### 9.1 Start Docker Services

```bash
npm run docker:up
```

**Verify**:
```bash
docker ps
```

Should show `appraisal-db` and `appraisal-redis` containers running.

### 9.2 Install All Dependencies

```bash
npm install
```

This installs dependencies for all workspaces.

### 9.3 Generate Prisma Client

```bash
npm run prisma:generate
```

### 9.4 Run Migrations

```bash
npm run prisma:migrate
```

Name the migration: `init`

### 9.5 Start Development Servers

```bash
npm run dev
```

This starts both API (port 3001) and Web (port 3000) in watch mode.

---

## Step 10: Create Feature Branch Workflow

### Example: Adding a New Feature

```bash
# Start from develop
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/otp-authentication

# Work on feature...
# (make changes, test locally)

# Stage and commit
git add .
git commit -m "feat(auth): implement OTP email authentication

- Add OTP code generation service
- Add email sending via SendGrid
- Add OTP verification endpoint
- Add rate limiting for OTP requests"

# Push feature branch
git push -u origin feature/otp-authentication

# Open Pull Request on GitHub to merge into develop
```

### Commit Message Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style changes (formatting)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks (dependencies, scripts)

---

## Step 11: Common Development Commands

### Database Management

```bash
# Open Prisma Studio (database GUI)
npm run prisma:studio

# Create new migration
npm run prisma:migrate

# Reset database (CAUTION: deletes all data)
cd apps/api && npx prisma migrate reset

# Seed database
npm run seed
```

### Development

```bash
# Start both servers
npm run dev

# Start API only
npm run dev:api

# Start Web only
npm run dev:web

# View Docker logs
npm run docker:logs postgres
npm run docker:logs redis
```

### Code Quality

```bash
# Lint all code
npm run lint

# Format all code
npm run format

# Run tests
npm test
```

---

## Step 12: CI/CD Setup (Future)

### GitHub Actions Example

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [develop, main]
  push:
    branches: [develop, main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_pass
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run linter
        run: npm run lint
      
      - name: Run tests
        run: npm test
        env:
          DATABASE_URL: postgresql://test_user:test_pass@localhost:5432/test_db
```

---

## Troubleshooting

### Issue: Port Already in Use

```bash
# Find process using port 3000 or 3001
lsof -i :3000
lsof -i :3001

# Kill process
kill -9 <PID>
```

### Issue: Prisma Client Not Generated

```bash
# Regenerate Prisma client
npm run prisma:generate
```

### Issue: Database Connection Failed

```bash
# Check Docker containers
docker ps

# Restart Docker services
npm run docker:down
npm run docker:up

# Check PostgreSQL logs
docker logs appraisal-db
```

### Issue: Module Not Found

```bash
# Clear node_modules and reinstall
rm -rf node_modules apps/*/node_modules packages/*/node_modules
npm install
```

---

This completes the repository setup guide. You now have a fully configured monorepo with Git version control, Docker-based local development, and all necessary configuration files.
