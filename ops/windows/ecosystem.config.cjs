// pm2 definition for the Sortie server on Windows (spec §2).
// First start (once):  pm2 start ops\windows\ecosystem.config.cjs --only sortie && pm2 save
// Every logon after:   the `Sortie Server` scheduled task runs the same `pm2 start` (idempotent).
// Runs Next's bin directly instead of `npm start`: pm2 + npm.cmd shims leave orphaned node
// processes behind on restart on Windows. TZ is pinned here (not in .env) because Node reads TZ
// at process start, before Next loads .env.
const path = require("path");
const root = path.resolve(__dirname, "..", "..");

module.exports = {
  apps: [
    {
      name: "sortie",
      cwd: root,
      script: path.join(root, "node_modules", "next", "dist", "bin", "next"),
      args: "start -H 127.0.0.1 -p 3000",
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      kill_timeout: 10000,
      // Safety net for the always-on box: if the server process itself ever leaks past this,
      // pm2 restarts it (detached executor children are unaffected). Normal footprint is ~300 MB.
      max_memory_restart: "1500M",
      out_file: path.join(root, "data", "pm2-out.log"),
      error_file: path.join(root, "data", "pm2-err.log"),
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        TZ: "America/Los_Angeles",
        PORT: "3000",
      },
    },
  ],
};
