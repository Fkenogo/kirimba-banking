import fs from "node:fs/promises";

const CDP_PORT = "9222";
const BASE_URL = "http://127.0.0.1:5174";
const OUTPUTS = {
  notifications: "agent-notifications-screen.png",
  settlements: "agent-settlements-lifecycle.png",
  activity: "agent-activity-feed.png",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value;
}

async function waitFor(client, predicate, timeoutMs = 25000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(client, predicate);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${predicate}`);
}

async function capture(client, file) {
  await client.send("Page.bringToFront");
  await delay(600);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await fs.writeFile(file, Buffer.from(data, "base64"));
}

async function getAuthenticatedAgentTarget() {
  const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
  const existing = targets.find((item) => item.url.startsWith(`${BASE_URL}/agent/`));
  if (!existing) {
    throw new Error("Could not find an authenticated agent tab.");
  }
  return existing;
}

async function prepareClient() {
  const target = await getAuthenticatedAgentTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 1200,
    deviceScaleFactor: 2,
    mobile: true,
  });
  return client;
}

async function navigateTo(client, url) {
  await evaluate(client, `window.location.href = ${JSON.stringify(url)}`);
  await delay(1500);
}

async function tapButtonByText(client, text) {
  return evaluate(client, `(() => {
    const match = [...document.querySelectorAll('button')].find((node) => node.innerText && node.innerText.includes(${JSON.stringify(text)}));
    if (!match) return false;
    match.click();
    return true;
  })()`);
}

const client = await prepareClient();

await navigateTo(client, `${BASE_URL}/agent/notifications`);
await waitFor(client, "document.body && document.body.innerText.toLowerCase().includes('latest notifications')");
await waitFor(client, "document.body && document.body.innerText.toLowerCase().includes('settlement approved')");
await tapButtonByText(client, "Mark read");
await delay(1200);
await capture(client, OUTPUTS.notifications);

await navigateTo(client, `${BASE_URL}/agent/settlements`);
await waitFor(client, "document.body && document.body.innerText.toLowerCase().includes('settlement payable')");
await waitFor(client, "document.body && document.body.innerText.toLowerCase().includes('approved for payout')");
await waitFor(client, "document.body && document.body.innerText.toLowerCase().includes('blocked while another commission payout remains open')");
await capture(client, OUTPUTS.settlements);

await navigateTo(client, `${BASE_URL}/agent/activity`);
await waitFor(client, "document.body && document.body.innerText.toLowerCase().includes('daily activity feed')");
await waitFor(client, "document.body && document.body.innerText.toLowerCase().includes('loan repayment')");
await capture(client, OUTPUTS.activity);

console.log(JSON.stringify(OUTPUTS, null, 2));
