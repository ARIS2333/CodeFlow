#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required. Install it from https://brew.sh and run this script again."
  exit 1
fi

if ! brew list postgresql@17 >/dev/null 2>&1; then
  echo "PostgreSQL 17 is not installed. Run: brew install postgresql@17"
  exit 1
fi

brew services start postgresql@17
createdb codeflow_study 2>/dev/null || true
echo "Local database ready: postgresql://localhost/codeflow_study"
echo "Add DATABASE_URL=postgresql://localhost/codeflow_study to backend/.env"
