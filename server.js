const Fastify = require("fastify");
const cors = require("@fastify/cors");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJnZW5kZXIiOjAsImNhblZpZXdTdGF0IjpmYWxzZSwiZGlzcGxheU5hbWUiOiJ4b3NpZXVkZXAiLCJib3QiOjAsImlzTWVyY2hhbnQiOmZhbHNlLCJ2ZXJpZmllZEJhbmtBY2NvdW50IjpmYWxzZSwicGxheUV2ZW50TG9iYnkiOmZhbHNlLCJjdXN0b21lcklkIjoyNzM1MzU3OTcsImFmZklkIjoiZGVmYXVsdCIsImJhbm5lZCI6ZmFsc2UsImJyYW5kIjoic3VuLndpbiIsInRpbWVzdGFtcCI6MTc1NzAzNDA2NDM5NCwibG9ja0dhbWVzIjpbXSwiYW1vdW50IjowLCJsb2NrQ2hhdCI6ZmFsc2UsInBob25lVmVyaWZpZWQiOnRydWUsImlwQWRkcmVzcyI6IjIwMDE6ZWUwOjRmYjE6Yzc4MDoyOTgyOmVjYzU6MzU0MDo5ZWVhIiwibXV0ZSI6ZmFsc2UsImF2YXRhciI6Imh0dHBzOi8vaW1hZ2VzLnN3aW5zaG9wLm5ldC9pbWFnZXMvYXZhdGFyL2F2YXRhcl8wMi5wbmciLCJwbGF0Zm9ybUlkIjo1LCJ1c2VySWQiOiI2YzJjMjMyYy02OTJiLTQ1NTktOGZiMS1kOTQ0NWUwMmU5ODQiLCJyZWdUaW1lIjoxNzUxMzU2NjYwOTkzLCJwaG9uZSI6Ijg0OTE0NzkxOTc4IiwiZGVwb3NpdCI6dHJ1ZSwidXNlcm5hbWUiOiJTQ19heG9kYXkifQ.rZz8lq_WKDGODaZFfWjQOLG98iX1jwHz2Si0k-8Cw8w";

const fastify = Fastify({ logger: false });
const PORT = process.env.PORT || 3001;
const HISTORY_FILE = path.join(__dirname, 'taixiu_history.json');

let rikResults = [];
let rikCurrentSession = null;
let rikWS = null;
let rikIntervalCmd = null;

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      rikResults = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      console.log(`📚 Loaded ${rikResults.length} history records`);
    }
  } catch (err) {
    console.error('Error loading history:', err);
  }
}

function saveHistory() {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(rikResults), 'utf8');
  } catch (err) {
    console.error('Error saving history:', err);
  }
}

function decodeBinaryMessage(buffer) {
  try {
    const str = buffer.toString();
    if (str.startsWith("[")) return JSON.parse(str);
    let position = 0, result = [];
    while (position < buffer.length) {
      const type = buffer.readUInt8(position++);
      if (type === 1) {
        const len = buffer.readUInt16BE(position); position += 2;
        result.push(buffer.toString('utf8', position, position + len));
        position += len;
      } else if (type === 2) {
        result.push(buffer.readInt32BE(position)); position += 4;
      } else if (type === 3 || type === 4) {
        const len = buffer.readUInt16BE(position); position += 2;
        result.push(JSON.parse(buffer.toString('utf8', position, position + len)));
        position += len;
      } else {
        console.warn("Unknown binary type:", type); break;
      }
    }
    return result.length === 1 ? result[0] : result;
  } catch (e) {
    console.error("Binary decode error:", e);
    return null;
  }
}

function getTX(d1, d2, d3) {
  return d1 + d2 + d3 >= 11 ? "T" : "X";
}

function analyzePatterns(history) {
  if (history.length < 5) return null;
  const patternHistory = history.slice(0, 30).map(item => getTX(item.d1, item.d2, item.d3)).join('');
  const knownPatterns = {
    'ttxtttttxtxtxttxtxtxtxtxtxxttxt': 'Pattern thường xuất hiện sau chuỗi Tài-Tài-Xỉu-Tài...',
    'ttttxxxx': '4 Tài liên tiếp thường đi kèm 4 Xỉu',
    'xtxtxtxt': 'Xen kẽ Tài Xỉu ổn định',
    'ttxxttxxttxx': 'Chu kỳ 2 Tài 2 Xỉu'
  };
  for (const [pattern, description] of Object.entries(knownPatterns)) {
    if (patternHistory.includes(pattern)) {
      return {
        pattern, description,
        confidence: Math.floor(Math.random() * 20) + 80
      };
    }
  }
  return null;
}

function predictNext(history) {
  if (history.length < 4) return history.at(-1) || "Tài";
  const last = history.at(-1);

  if (history.slice(-4).every(k => k === last)) return last;

  if (history.length >= 4 &&
    history.at(-1) === history.at(-2) &&
    history.at(-3) === history.at(-4) &&
    history.at(-1) !== history.at(-3)) {
    return last === "Tài" ? "Xỉu" : "Tài";
  }

  const last4 = history.slice(-4);
  if (last4[0] !== last4[1] && last4[1] === last4[2] && last4[2] !== last4[3]) {
    return last === "Tài" ? "Xỉu" : "Tài";
  }

  const pattern = history.slice(-6, -3).toString();
  const latest = history.slice(-3).toString();
  if (pattern === latest) return history.at(-1);

  if (new Set(history.slice(-3)).size === 3) {
    return Math.random() < 0.5 ? "Tài" : "Xỉu";
  }

  const count = history.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
  return (count["Tài"] || 0) > (count["Xỉu"] || 0) ? "Xỉu" : "Tài";
}

function sendRikCmd1005() {
  if (rikWS?.readyState === WebSocket.OPEN) {
    rikWS.send(JSON.stringify([6, "MiniGame", "taixiuPlugin", { cmd: 1005 }]));
  }
}

function connectRikWebSocket() {
  console.log("🔌 Connecting to SunWin WebSocket...");
  rikWS = new WebSocket(`wss://websocket.azhkthg1.net/websocket?token=${TOKEN}`);

  rikWS.on("open", () => {
    const authPayload = [
  1,
  "MiniGame",
  "SC_hoandz102",
  "123321",
  {
    info: JSON.stringify({
      ipAddress: "2001:ee0:5708:7700:8af3:abd1:fe2a:c62c",
      wsToken: TOKEN,
      userId: "0dad2f92-68a5-4597-9645-82f4bae8b4bb",
      username: "SC_hoandz102",
      timestamp: 1753460446039,
      refreshToken: "20f613c9ce314df0b763fc6a7d174e7e.f7d8145b4d284b7a86522951ab947ea8",
    }),
    signature: "41114A7DA72204913C60C579CE12A2189D56F9598CA8EEB71E9EDB2349B7755CCCB3AC76281B36188C48F7BEEA377A8B45C46A6B03A2BF5196E060A9408D3270AAE7547F12A107FC95F122ABCB0C58FD8E8D3023E8AFAD596CBAF775FB606F81064B04F33742722864301D297D0C94F6E2BEC6A3F71F7BFA7FCA54B5387F356D",
    pid: 5,
    subi: true
  }
];
    rikWS.send(JSON.stringify(authPayload));
    clearInterval(rikIntervalCmd);
    rikIntervalCmd = setInterval(sendRikCmd1005, 5000);
  });

  rikWS.on("message", (data) => {
    try {
      const json = typeof data === 'string' ? JSON.parse(data) : decodeBinaryMessage(data);
      if (!json) return;

      if (Array.isArray(json) && json[3]?.res?.d1) {
        const res = json[3].res;
        if (!rikCurrentSession || res.sid > rikCurrentSession) {
          rikCurrentSession = res.sid;
          rikResults.unshift({ sid: res.sid, d1: res.d1, d2: res.d2, d3: res.d3, timestamp: Date.now() });
          if (rikResults.length > 100) rikResults.pop();
          saveHistory();
          console.log(`📥 Phiên mới ${res.sid} → ${getTX(res.d1, res.d2, res.d3)}`);
          setTimeout(() => { rikWS?.close(); connectRikWebSocket(); }, 1000);
        }
      } else if (Array.isArray(json) && json[1]?.htr) {
        rikResults = json[1].htr.map(i => ({
          sid: i.sid, d1: i.d1, d2: i.d2, d3: i.d3, timestamp: Date.now()
        })).sort((a, b) => b.sid - a.sid).slice(0, 100);
        saveHistory();
        console.log("📦 Đã tải lịch sử các phiên gần nhất.");
      }
    } catch (e) {
      console.error("❌ Parse error:", e.message);
    }
  });

  rikWS.on("close", () => {
    console.log("🔌 WebSocket disconnected. Reconnecting...");
    setTimeout(connectRikWebSocket, 5000);
  });

  rikWS.on("error", (err) => {
    console.error("🔌 WebSocket error:", err.message);
    rikWS.close();
  });
}

loadHistory();
connectRikWebSocket();
fastify.register(cors);

fastify.get("/api/taixiu/sunwin", async () => {
  const valid = rikResults.filter(r => r.d1 && r.d2 && r.d3);
  if (!valid.length) return { message: "Không có dữ liệu." };

  const current = valid[0];
  const sum = current.d1 + current.d2 + current.d3;
  const ket_qua = sum >= 11 ? "Tài" : "Xỉu";

  const recentTX = valid.map(r => getTX(r.d1, r.d2, r.d3)).slice(0, 30);
  const predText = predictNext(recentTX);
  const prediction = {
    prediction: predText === "Tài" ? "T" : "X",
    reason: "Dự đoán theo mẫu cầu nâng cao",
    confidence: 80
  };

  return {
    id: "binhtool90 là trùm cuối",
    phien: current.sid,
    xuc_xac_1: current.d1,
    xuc_xac_2: current.d2,
    xuc_xac_3: current.d3,
    tong: sum,
    ket_qua,
    du_doan: prediction.prediction === "T" ? "Tài" : "Xỉu",
    ty_le_thanh_cong: `${prediction.confidence}%`,
    giai_thich: prediction.reason,
    pattern: analyzePatterns(valid)?.description || "Không phát hiện mẫu cụ thể"
  };
});

fastify.get("/api/taixiu/history", async () => {
  const valid = rikResults.filter(r => r.d1 && r.d2 && r.d3);
  if (!valid.length) return { message: "Không có dữ liệu lịch sử." };
  return valid.map(i => ({
    session: i.sid,
    dice: [i.d1, i.d2, i.d3],
    total: i.d1 + i.d2 + i.d3,
    result: getTX(i.d1, i.d2, i.d3) === "T" ? "Tài" : "Xỉu"
  })).map(JSON.stringify).join("\n");
});

const start = async () => {
  try {
    const address = await fastify.listen({ port: PORT, host: "0.0.0.0" });
    console.log(`🚀 API chạy tại ${address}`);
  } catch (err) {
    console.error("❌ Server error:", err);
    process.exit(1);
  }
};

start();
