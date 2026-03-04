# Git Push-to-Deploy (Local Network, No GitHub)

This sets up a bare git repo on the Linux server so you can push changes from
your Mac and have the server automatically build and restart.

**Server details**
- User: `homelab`
- Project path: `~/Projects/galactic-tycoons-manager`
- Bare repo path: `~/Projects/galactic-tycoons-manager.git`

---

## One-time setup — Linux server

### 1. Create the bare repo

```bash
git init --bare ~/Projects/galactic-tycoons-manager.git
```

### 2. Create the post-receive hook

```bash
nano ~/Projects/galactic-tycoons-manager.git/hooks/post-receive
```

Paste the following:

```bash
#!/bin/bash
set -e

WORK_DIR=~/Projects/galactic-tycoons-manager
GIT_DIR=~/Projects/galactic-tycoons-manager.git

echo "==> Checking out latest code..."
git --work-tree="$WORK_DIR" --git-dir="$GIT_DIR" checkout -f main

echo "==> Installing server dependencies..."
cd "$WORK_DIR/server"
npm install --omit=dev

echo "==> Building client..."
npm run build

echo "==> Restarting server..."
pm2 restart galactic-tycoons

echo "==> Deploy complete."
```

Make it executable:

```bash
chmod +x ~/Projects/galactic-tycoons-manager.git/hooks/post-receive
```

---

## One-time setup — Mac

### 3. Initialise a local git repo (if not already done)

From the project root on your Mac:

```bash
cd ~/galactic-tycoons-manager
git init
git add -A
git commit -m "initial commit"
```

### 4. Add the Linux server as a remote

```bash
git remote add linux homelab@<host-ip>:~/Projects/galactic-tycoons-manager.git
```

Replace `<host-ip>` with the server's IP address (e.g. `192.168.1.42`).

### 5. Push for the first time

```bash
git push linux main
```

---

## Day-to-day workflow

```bash
# 1. Make your changes on the Mac (edit files, test locally with npm run dev)

# 2. Stage and commit
git add -A
git commit -m "describe what changed"

# 3. Push to the server — hook runs automatically
git push homelab main
```

The hook will:
1. Check out the new code on the server
2. Run `npm install` (picks up any new packages)
3. Run `npm run build` (rebuilds the React client into server/public/)
4. Restart PM2 (live within a few seconds, no snapshot data lost)

---

## Useful commands

| Task | Command |
|------|---------|
| Check server logs after deploy | `pm2 logs galactic-tycoons` |
| Check server status | `pm2 list` |
| Manually restart without deploying | `pm2 restart galactic-tycoons` |
| See what remote points to | `git remote -v` |
| View local commit history | `git log --oneline` |

---

## Troubleshooting

**`Permission denied (publickey)`**
Set up SSH key auth so you don't need a password on every push:
```bash
ssh-copy-id homelab@<host-ip>
```

**Hook not running / permission denied**
```bash
chmod +x ~/Projects/galactic-tycoons-manager.git/hooks/post-receive
```

**PM2 not found in hook**
The hook runs in a non-interactive shell and may not have PM2 in `$PATH`.
Find the full path first, then hard-code it in the hook:
```bash
which pm2
# e.g. /usr/local/bin/pm2 — use that in the hook instead of just "pm2"
```

**Push rejected — non-fast-forward**
Your local branch is behind. This shouldn't happen in normal use since only
you push to this remote. If it does:
```bash
git push linux main --force
```
