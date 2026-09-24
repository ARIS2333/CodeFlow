# CodeFlow Frontend Setup and Running Guide

## Requirements

- Node.js 22.14.0
- npm, included with Node.js
- A running or accessible CodeFlow backend

## Install dependencies

```bash
cd frontend
npm ci
```

`npm ci` installs the dependency versions recorded in the lock file and is recommended for initial setup and continuous integration.

## Configure the backend address

On macOS, Linux, or Git Bash:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set the value to the public address of the backend:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:5001
```

The default value above is suitable for local development. For deployment, replace it with the HTTPS address of the deployed backend, for example:

```dotenv
VITE_API_BASE_URL=https://your-backend.example.com
```

Vite reads this variable at build time. Rebuild the frontend after changing the production backend address.

## Start the development server

```bash
npm run dev
```

The terminal will show the available address, usually `http://localhost:5173`.

## Test and build

```bash
npm test
npm run lint
npm run build
```

- `npm test` runs the frontend tests.
- `npm run lint` checks formatting rules and common issues.
- `npm run build` creates the production build in `dist`.

Preview the production build locally with:

```bash
npm run preview
```

For complete production configuration, see [../Docs/DEPLOYMENT.md](../Docs/DEPLOYMENT.md).
