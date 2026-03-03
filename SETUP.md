# Galactic Tycoons Manager — Setup Guide (Linux)

This guide covers deploying the app on a Linux machine on your local network so it's
accessible from any device (phone, tablet, other laptop) without running a dev server.

Commands assume **Ubuntu / Debian**. Adjust package manager calls (`apt`) for other
distros (e.g. `dnf` on Fedora, `pacman` on Arch).

---

## Prerequisites

### Node.js 18+

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x.x or similar
```

### PostgreSQL 14+

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### PM2

```bash
sudo npm install -g pm2
```

---

## 1 — Copy the project

Run this from your **current (Mac) machine** to push the project to the Linux host:

```bash
rsync -av --exclude='node_modules' --exclude='.env' \
  /Users/kieran/galactic-tycoons-manager/ \
  user@<host-ip>:~/galactic-tycoons-manager/
```

Replace `user` with the Linux username and `<host-ip>` with the host's IP address.
The `node_modules` and `.env` exclusions keep the transfer fast and safe.

---

## 2 — Create the database

On the Linux host, PostgreSQL creates a system user called `postgres`. Use it to
create the database:

```bash
sudo -u postgres psql
```

```sql
CREATE DATABASE galactic_tycoons;
\q
```

---

## 3 — Configure environment variables

Create `server/.env` on the Linux host:

```bash
nano ~/galactic-tycoons-manager/server/.env
```

First, set a password for the `postgres` database role (PostgreSQL on Linux requires
a password for TCP connections by default):

```bash
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'galactic';"
```

Then paste into the `.env` file:

```
PORT=3001
GT_API_KEY=qVg896MqV5D2
GT_API_BASE=https://api.g2.galactictycoons.com
DATABASE_URL=postgresql://postgres:galactic@localhost:5432/galactic_tycoons
```

Change `galactic` to any password you like — just keep it consistent between the
`ALTER USER` command and the `DATABASE_URL`.

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X` in nano).

---

## 4 — Install dependencies

```bash
cd ~/galactic-tycoons-manager/server
npm install

cd ../client
npm install
```

---

## 5 — Initialise the database schema

Run once to create all tables (safe to re-run — uses `CREATE IF NOT EXISTS`):

```bash
cd ~/galactic-tycoons-manager/server
npm run init-db
```

---

## 5a — Migrate existing data (optional)

If you have historical tracker data on the old machine that you want to carry over,
you have two options:

**Option A — Migrate before starting (simplest):** follow this step now, before step 7.

**Option B — Set up and test first, migrate later:** complete all steps through step 7
to confirm everything works, then run the migration block below when you're ready.
Stop the server first, wipe the test data, restore the backup, then restart:

```bash
pm2 stop galactic-tycoons
sudo -u postgres psql -c "DROP DATABASE galactic_tycoons;"
sudo -u postgres psql -c "CREATE DATABASE galactic_tycoons;"
sudo -u postgres psql galactic_tycoons < ~/galactic_tycoons_backup.sql
pm2 start galactic-tycoons
```

Take a **fresh dump from the Mac** right before doing this — not the one from earlier —
so you lose as little data as possible during the migration window.

> Note: you cannot merge the two databases after both have been running. Both use
> auto-incrementing IDs starting from 1, which would collide. The wipe-and-restore
> approach above is the correct path.

---

**Migration steps** (for Option A, or the restore step in Option B):

**On the old machine** — dump the database:
```bash
pg_dump galactic_tycoons > ~/Desktop/galactic_tycoons_backup.sql
```

**Copy to the Linux host:**
```bash
scp ~/Desktop/galactic_tycoons_backup.sql user@<host-ip>:~/
```

**On the Linux host** — restore it:
```bash
sudo -u postgres psql galactic_tycoons < ~/galactic_tycoons_backup.sql
```

This carries over all collected history:
- `tracker_snapshots` — 60s price/supply snapshots
- `tracker_orders` — full order book at each snapshot
- `tracker_events` — all inferred fills, cancellations, new listings
- `price_snapshots` — general market price history

---

## 6 — Build the client

Compiles the React app into static files the Express server will serve directly:

```bash
cd ~/galactic-tycoons-manager/server
npm run build
```

Output lands in `server/public/`. Re-run this any time you change frontend code,
then restart the server (`pm2 restart galactic-tycoons`).

---

## 7 — Start with PM2

From the **project root**:

```bash
cd ~/galactic-tycoons-manager
pm2 start ecosystem.config.cjs
```

Verify it's running:

```bash
pm2 list
pm2 logs galactic-tycoons   # live log tail, Ctrl+C to exit
```

---

## 8 — Persist across reboots

```bash
pm2 save       # save current process list
pm2 startup    # generates a systemd command — copy and run it
```

The output will look like:

```
[PM2] To setup the Startup Script, copy/paste the following command:
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u youruser --hp /home/youruser
```

Copy that exact command and run it. PM2 will now start automatically on boot and
bring the server back up without any manual intervention.

---

## 9 — Find the host's IP address

```bash
hostname -I
# or
ip addr show | grep "inet " | grep -v 127.0.0.1
```

Look for the LAN address — typically `192.168.x.x` or `10.0.x.x`.

You can make it easier to remember by setting a static IP in your router's DHCP
settings (assign a fixed IP to the host machine's MAC address).

---

## 10 — Access from any device

Open a browser on any device on the same Wi-Fi / LAN and go to:

```
http://<host-ip>:3001
```

Example: `http://192.168.1.42:3001`

The tracker collects a snapshot every 60 seconds regardless of whether any browser
is open — as long as PM2 is running.

---

## Day-to-day operations

| Task | Command (from project root) |
|------|-----------------------------|
| View live logs | `pm2 logs galactic-tycoons` |
| Check status | `pm2 list` |
| Restart after a server-side code change | `pm2 restart galactic-tycoons` |
| Rebuild UI + restart | `cd server && npm run build && pm2 restart galactic-tycoons` |
| Stop the server | `pm2 stop galactic-tycoons` |
| Backfill historical tracker events | `cd server && npm run backfill-events` |

---

## Troubleshooting

**`EACCES` / permission denied on port 3001**
Ports above 1024 don't need root on Linux. If you changed `PORT` to something
below 1024, either revert it or run:
```bash
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

**Database connection refused**
Check PostgreSQL is running:
```bash
sudo systemctl status postgresql
```
If it's stopped: `sudo systemctl start postgresql`.
Double-check `DATABASE_URL` in `server/.env`.

**Peer authentication failed for user "postgres"**
Edit `/etc/postgresql/<version>/main/pg_hba.conf` and change the `postgres` line
from `peer` to `md5`, then `sudo systemctl restart postgresql`.
Alternatively, create a dedicated db user:
```bash
sudo -u postgres createuser --pwprompt galactic
sudo -u postgres psql -c "GRANT ALL ON DATABASE galactic_tycoons TO galactic;"
```
Then update `DATABASE_URL` to use that user and password.

**Blank page / assets not loading**
The client has not been built yet. Run `npm run build` from `server/`, then restart.

**Tracker not collecting data**
Check logs: `pm2 logs galactic-tycoons` — look for rate limit or API key errors.
The tracker status (live / stopped, poll count) is also shown in the header of the
Tracker page.

**Firewall blocking port 3001**
If the host runs `ufw`:
```bash
sudo ufw allow 3001/tcp
```
