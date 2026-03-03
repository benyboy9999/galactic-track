// PM2 process config — keeps the server (and tracker) running permanently.
// Usage:
//   pm2 start ecosystem.config.cjs   ← start
//   pm2 save                          ← persist process list across reboots
//   pm2 startup                       ← register PM2 with the OS init system
//   pm2 logs galactic-tycoons         ← tail logs
//   pm2 restart galactic-tycoons      ← restart after a code change

module.exports = {
  apps: [
    {
      name: 'galactic-tycoons',
      script: 'src/index.js',
      cwd: __dirname + '/server',
      watch: false,
      autorestart: true,
      max_restarts: 20,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
  ],
};
