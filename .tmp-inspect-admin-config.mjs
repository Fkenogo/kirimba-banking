const TARGET_URL = "http://127.0.0.1:5175/admin/super/config";

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

const targets = await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json());
const target = targets.find((item) => item.url === TARGET_URL);
if (!target) {
  throw new Error(`Could not find target ${TARGET_URL}`);
}

const client = new CdpClient(target.webSocketDebuggerUrl);
await client.send("Runtime.enable");
const result = await client.send("Runtime.evaluate", {
  expression: "document.body ? document.body.innerText : ''",
  returnByValue: true,
});

console.log(result.result?.value || "");
