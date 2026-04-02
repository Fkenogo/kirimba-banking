import fs from "node:fs/promises";

const CDP_PORT = "9222";
const TARGET_URL = "http://127.0.0.1:5174/agent/dashboard";
const OUTPUT = "agent-business-dashboard-aligned.png";

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) reject(new Error(payload.error.message));
        else resolve(payload.result);
      }
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
}

const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.url === TARGET_URL);
if (!target) {
  throw new Error(`Could not find target ${TARGET_URL}`);
}

const client = new CdpClient(target.webSocketDebuggerUrl);
await client.send("Page.enable");
await client.send("Page.bringToFront");
await new Promise((resolve) => setTimeout(resolve, 800));
const { data } = await client.send("Page.captureScreenshot", {
  format: "png",
  captureBeyondViewport: true,
});
await fs.writeFile(OUTPUT, Buffer.from(data, "base64"));
console.log(OUTPUT);
