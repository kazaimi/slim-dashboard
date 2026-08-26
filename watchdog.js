"use strict";

// slim-dashboard watchdog (windowless): checks the health endpoint every 60s
// and silently respawns the server when it stops responding.
const { spawn } = require("node:child_process");
const http = require("node:http");

const ROOT = __dirname;
const HEALTH_URL = "http://127.0.0.1:6388/api/health";

function alive() {
  return new Promise((resolve) => {
    const req = http.get(HEALTH_URL, (res) => {
      const ok = res.statusCode === 200;
      res.resume();
      resolve(ok);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(4000, () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  const child = spawn(process.execPath, [ROOT + "/server.js"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

(async () => {
  while (true) {
    if (!(await alive())) {
      try { startServer(); } catch {}
      await new Promise((r) => setTimeout(r, 5000));
    }
    await new Promise((r) => setTimeout(r, 60000));
  }
})();
