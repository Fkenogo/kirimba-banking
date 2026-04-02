import fs from "node:fs/promises";

const CDP_PORT = "9222";
const TARGET_URL = "http://127.0.0.1:5175/admin/super/config";
const OUTPUTS = {
  fees: "admin-pricing-rules-fees.png",
  commission: "admin-pricing-rules-commission.png",
  loanPolicy: "admin-pricing-rules-loan-policy.png",
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

async function waitFor(client, predicate, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await evaluate(client, predicate);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${predicate}`);
}

async function setInputValue(client, selector, value) {
  const ok = await evaluate(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor.set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
  if (!ok) throw new Error(`Could not set ${selector}`);
}

async function clickContaining(client, text) {
  const ok = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button, a")].find((node) =>
        node.textContent && node.textContent.includes(${JSON.stringify(text)})
      );
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!ok) throw new Error(`Could not click containing ${text}`);
}

async function clickExactButton(client, text) {
  const ok = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll("button")].find((node) =>
        node.textContent && node.textContent.trim() === ${JSON.stringify(text)}
      );
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!ok) throw new Error(`Could not click exact button ${text}`);
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

const targets = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
const target = targets.find((item) => item.url === TARGET_URL);
if (!target) {
  throw new Error(`Could not find target ${TARGET_URL}`);
}

const client = new CdpClient(target.webSocketDebuggerUrl);
await client.send("Page.enable");
await client.send("Runtime.enable");
await client.send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1200,
  deviceScaleFactor: 1,
  mobile: false,
});

await waitFor(client, "document.body && document.body.innerText.includes('Pricing & Rules')");
await clickExactButton(client, "Fees");
await waitFor(
  client,
  "document.body && document.body.innerText.includes('Live Agent Transaction Fees')"
);
await capture(client, OUTPUTS.fees);

await clickExactButton(client, "Commission Policy");
await waitFor(client, "document.body && document.body.innerText.includes('Commission Policy View')");
await capture(client, OUTPUTS.commission);

await clickExactButton(client, "Loan Policy");
await waitFor(client, "document.body && document.body.innerText.includes('Live Loan Pricing Basis')");
await capture(client, OUTPUTS.loanPolicy);

console.log(JSON.stringify(OUTPUTS, null, 2));
