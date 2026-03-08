Developing
1. Open Tunnel to live server for DB
    ssh -L 5432:localhost:5432 root@galactic-track.com -N
2. cd server && npm run dev
3. cd client && npm run dev

Pushing Changes
0. git checkout main
1. git add .
2. git commit -m "change name"
3. git push origin main
4. ssh root@galactic-track.com "cd ~/galactic-track && git pull && npm run build && pm2 restart galactic-track"

