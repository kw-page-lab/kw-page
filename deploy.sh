#!/usr/bin/env bash
# KimeraWare deploy script
# Usage: ./deploy.sh
set -e

echo "🔨 Building..."
npm run build

echo "📦 Deploying to /var/www/kimeraware..."
sudo cp -r dist/assets/* /var/www/kimeraware/assets/
sudo cp dist/index.html /var/www/kimeraware/index.html

echo "🔄 Restarting event server..."
pm2 restart kimeraware-events

echo "✅ Deploy complete!"
