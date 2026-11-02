#!/bin/bash
set -e

echo "🚀 Starting Zero-Downtime Deployment for Wasla (وصلة)..."

# Configuration
REPO_TOKEN="${1:-$(cat /home/wasla-eg.cloud/deploy/.github_token 2>/dev/null)}"
if [ -z "$REPO_TOKEN" ]; then
  echo "⚠️ GITHUB_TOKEN not provided as argument. Trying without token..."
  REPO_URL="https://github.com/fast-order-eg/wasla.git"
else
  REPO_URL="https://x-access-token:${REPO_TOKEN}@github.com/fast-order-eg/wasla.git"
fi

BASE_DIR="${DEPLOY_BASE_DIR:-/home/wasla-eg.cloud/deploy}"
RELEASES_DIR="$BASE_DIR/releases"
SHARED_DIR="$BASE_DIR/shared"
CURRENT_DIR="$BASE_DIR/current"
RELEASE_NAME=$(date +"%Y%m%d%H%M%S")
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

echo "📁 Ensuring base directories exist..."
mkdir -p "$RELEASES_DIR"
mkdir -p "$SHARED_DIR"
mkdir -p "$SHARED_DIR/data"
mkdir -p "$SHARED_DIR/uploads"

echo "📦 Creating release directory: $RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

echo "📥 Cloning repository..."
git clone --depth 1 "$REPO_URL" "$RELEASE_DIR"

echo "🔗 Linking shared persistent files..."

# 1. Environment file (.env)
if [ -f "$SHARED_DIR/.env" ]; then
  ln -nfs "$SHARED_DIR/.env" "$RELEASE_DIR/.env"
else
  echo "⚠️ .env not found in shared directory. Copying from .env.example..."
  cp "$RELEASE_DIR/.env.example" "$SHARED_DIR/.env"
  ln -nfs "$SHARED_DIR/.env" "$RELEASE_DIR/.env"
fi

# 2. Database directory (preserve SQLite data)
rm -rf "$RELEASE_DIR/data"
ln -nfs "$SHARED_DIR/data" "$RELEASE_DIR/data"

# 3. Media uploads directory
rm -rf "$RELEASE_DIR/public/uploads"
ln -nfs "$SHARED_DIR/uploads" "$RELEASE_DIR/public/uploads"

# 4. Optional Google Service Account Credentials
if [ -f "$SHARED_DIR/google-key.json" ]; then
  ln -nfs "$SHARED_DIR/google-key.json" "$RELEASE_DIR/google-key.json"
fi

echo "⚙️ Installing production dependencies..."
cd "$RELEASE_DIR"
npm install --omit=dev --no-audit --no-fund

echo "🔄 Swapping symlink to activate new release (Zero-Downtime)..."
ln -nfs "$RELEASE_DIR" "$CURRENT_DIR"

echo "⚡ Reloading PM2 processes without dropping connections..."
cd "$CURRENT_DIR"
if command -v pm2 > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs
  pm2 save || true
else
  echo "⚠️ PM2 not found on PATH. Please ensure PM2 is running."
fi

echo "🧹 Cleaning up old releases (keeping last 3)..."
cd "$RELEASES_DIR"
ls -1t | tail -n +4 | xargs -r rm -rf

echo "✅ Wasla Zero-Downtime Deployment completed successfully!"
