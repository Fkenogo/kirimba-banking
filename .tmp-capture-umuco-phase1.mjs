import fs from "node:fs/promises";

const CDP_PORT = "9222";
const BASE_URL = "http://127.0.0.1:5176";
const OUTPUTS = {
  login: "umuco-login-generic-shell.png",
  pending: "umuco-pending-batches-filters.png",
  history: "umuco-batch-history-filters.png",
  flagged: "umuco-flagged-batches.png",
  detail: "umuco-batch-detail.png",
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
  await delay(700);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await fs.writeFile(file, Buffer.from(data, "base64"));
}

async function createTarget() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(BASE_URL + "/umuco/login")}`, {
    method: "PUT",
  });
  return response.json();
}

async function prepareClient() {
  const target = await createTarget();
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1200,
    deviceScaleFactor: 1,
    mobile: false,
  });
  return client;
}

async function setInputValue(client, selector, value) {
  return evaluate(client, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value');
    descriptor.set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function tapButtonByText(client, text) {
  return evaluate(client, `(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.innerText && node.innerText.includes(${JSON.stringify(text)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

const client = await prepareClient();

await waitFor(client, "document.body && document.body.innerText.includes('Institution Operations Portal')");
await capture(client, OUTPUTS.login);

await setInputValue(client, 'input[type=\"tel\"]', '+25766100020');
await setInputValue(client, 'input[type=\"password\"]', '123456');
await evaluate(client, `(() => {
  const button = [...document.querySelectorAll('button')].find((node) => node.innerText.includes('Sign In'));
  if (!button) return false;
  button.click();
  return true;
})()`);

await waitFor(client, "window.location.pathname === '/umuco/home'");
await waitFor(client, "document.body && document.body.innerText.includes('Kibira SACCO')");

await evaluate(client, "window.location.href = 'http://127.0.0.1:5176/umuco/batch/seed_batch_confirm'");
await waitFor(client, "document.body && document.body.innerText.includes('Batch Detail')");
await setInputValue(client, 'input[placeholder=\"e.g. REF-2026-001\"]', 'INST-REF-001');
await setInputValue(client, 'textarea', 'Funds received and verified');
await tapButtonByText(client, 'Confirm Batch');
await waitFor(client, "document.body && document.body.innerText.includes('Batch confirmed successfully')");

await evaluate(client, "window.location.href = 'http://127.0.0.1:5176/umuco/batch/seed_batch_flag'");
await waitFor(client, "document.body && document.body.innerText.includes('Batch Detail')");
await setInputValue(client, 'textarea', 'Member total does not match the paper slip provided.');
await tapButtonByText(client, 'Flag Batch');
await waitFor(client, "document.body && document.body.innerText.includes('Batch flagged')");

await evaluate(client, "window.location.href = 'http://127.0.0.1:5176/umuco/batches'");
await waitFor(client, "document.body && document.body.innerText.includes('Pending Batches')");
await waitFor(client, "document.body && document.body.innerText.includes('Alice Agent')");
await capture(client, OUTPUTS.pending);

await evaluate(client, "window.location.href = 'http://127.0.0.1:5176/umuco/history'");
await waitFor(client, "document.body && document.body.innerText.includes('Batch History')");
await waitFor(client, "document.body && document.body.innerText.includes('INST-REF-001')");
await capture(client, OUTPUTS.history);

await evaluate(client, "window.location.href = 'http://127.0.0.1:5176/umuco/exceptions'");
await waitFor(client, "document.body && document.body.innerText.includes('Flagged Batches')");
await waitFor(client, "document.body && document.body.innerText.includes('paper slip')");
await capture(client, OUTPUTS.flagged);

await evaluate(client, "window.location.href = 'http://127.0.0.1:5176/umuco/batch/seed_batch_confirm'");
await waitFor(client, "document.body && document.body.innerText.includes('Batch Detail')");
await waitFor(client, "document.body && document.body.innerText.includes('Funds received and verified')");
await capture(client, OUTPUTS.detail);

console.log(JSON.stringify(OUTPUTS, null, 2));
