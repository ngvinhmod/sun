#!/usr/bin/env node

const http = require("http");
const https = require("https");
const url = require("url");
const os = require("os");

const HOST = "0.0.0.0";
const PORT = process.env.PORT || 8000;
const API_URL =
  "https://jakpotgwab.geightdors.net/glms/v1/notify/taixiu?platform_id=g8&gid=vgmn_101";

const POLL_INTERVAL = 5000;
const RETRY_DELAY = 5000;
const MAX_HISTORY = 100;

let cachedRaw = null;
let cachedParsed = null;
let lastPhien = null;
let historyParsed = [];

// === Lấy IP thật của server (cách cũ, chạy Node 12 ok) ===
let realIp = "localhost";
try {
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        realIp = iface.address;
        break;
      }
    }
  }
} catch (e) {
  realIp = "localhost";
}

// === Function tính Tài / Xỉu ===
function getTaiXiu(d1, d2, d3) {
  const total = d1 + d2 + d3;
  return total <= 10 ? "Xỉu" : "Tài";
}

// === Poll API ===
function pollApi() {
  https
    .get(API_URL, { headers: { "User-Agent": "Node-Proxy/1.0" } }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(body);
          cachedRaw = data;

          if (
            data.status === "OK" &&
            Array.isArray(data.data) &&
            data.data.length > 0
          ) {
            const game = data.data[0];
            const sid = game.sid;
            const d1 = game.d1;
            const d2 = game.d2;
            const d3 = game.d3;

            if (sid !== lastPhien && d1 != null && d2 != null && d3 != null) {
              lastPhien = sid;
              const parsed = {
                Phien: sid, // ✅ đổi sid → Phien
                Xuc_xac_1: d1,
                Xuc_xac_2: d2,
                Xuc_xac_3: d3,
                Tong: d1 + d2 + d3,
                Ket_qua: getTaiXiu(d1, d2, d3),
                id: "anhbaocx",
                updatedAt: new Date().toISOString(),
              };

              cachedParsed = parsed;
              historyParsed.push(parsed);
              if (historyParsed.length > MAX_HISTORY) historyParsed.shift();

              console.log(
                `[${new Date().toISOString()}] ✅ New HIT session:`,
                parsed
              );
            }
          }
        } catch (e) {
          console.error("❌ Parse error:", e.message);
        }
      });
    })
    .on("error", (err) => {
      console.error(`[${new Date().toISOString()}] ❌ Poll error:`, err.message);
      setTimeout(pollApi, RETRY_DELAY);
    });

  setTimeout(pollApi, POLL_INTERVAL);
}

// Start polling
pollApi();

// === HTTP SERVER ===
const server = http.createServer((req, res) => {
  const path = url.parse(req.url).pathname;
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (path === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <h1>HitClub Tài Xỉu API</h1>
      <ul>
        <li><a href="/api/hit">/api/hit</a> – JSON mới nhất</li>
        <li><a href="/hit-history">/hit-history</a> – Lịch sử</li>
        <li><a href="/game-data">/game-data</a> – Raw JSON</li>
        <li><a href="/health">/health</a> – Health check</li>
      </ul>
    `);
    return;
  }

  if (path === "/api/hit" || path === "/api/hitclub") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(cachedParsed || { error: "No data" }));
  }

  if (path === "/hit-history") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(historyParsed));
  }

  if (path === "/game-data") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(cachedRaw || { error: "No raw data" }));
  }

  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("OK");
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

// === Start server ===
server.listen(PORT, HOST, () => {
  console.log(`🟢 HTTP server running at http://${realIp}:${PORT}`);
});
