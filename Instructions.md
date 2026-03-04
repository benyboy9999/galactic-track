Developing
1. Open Tunnel to server for SQL 
    ssh -L 5432:localhost:5432 homelab@192.168.0.70 -N
2. cd server && npm run dev && cd ../client && npm run dev

Pushing Changes
1. git add .
2. git commit -m "change name"
3. git push homelab main