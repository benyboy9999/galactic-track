#!/bin/bash
set -e

SERVER=${GT_SERVER:-"root@galactic-track.com"}
APP_DIR=${GT_APP_DIR:-"/opt/galactic-track"}

echo "→ Deploying to $SERVER:$APP_DIR"

ssh "$SERVER" "
  set -e
  cd $APP_DIR

  echo '→ Pulling latest code'
  git pull origin main

  echo '→ Building client'
  cd client
  npm ci
  npm run build
  cd ..

  echo '→ Installing server deps'
  npm ci --prefix server

  echo '→ Running DB migrations'
  cd server && node src/database/init.js && cd ..

  echo '→ Reloading app'
  pm2 reload galactic-track || pm2 start server/src/index.js --name galactic-track
"

echo "✓ Deployed successfully"
