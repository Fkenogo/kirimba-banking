import fs from "node:fs/promises";

const CDP_PORT = process.env.CDP_PORT || "9222";
const AGENT_BASE_URL = "http://127.0.0.1:5174";
const ADMIN_BASE_URL = "http://127.0.0.1:5175";
const OUTPUTS = {
  dashboard: "agent-business-dashboard-aligned.png",
  fees: "admin-pricing-rules-fees.png",
  commission: "admin-pricing-rules-commission.png",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }
  return response.json();
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
    const id = this.nextId += 1;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

async function createClient(url) {
  const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 1200,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await client.send("Emulation.setVisibleSize", { width: 430, height: 1200 });
  return client;
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`Runtime evaluate failed: ${JSON.stringify(result.exceptionDetails)}`);
  }
  return result.result?.value;
}

async function waitFor(client, predicate, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await evaluate(client, predicate);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for predicate: ${predicate}`);
}

async function capture(client, filename) {
  await client.send("Page.bringToFront");
  await delay(400);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await fs.writeFile(filename, Buffer.from(data, "base64"));
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
  if (!ok) throw new Error(`Could not set input ${selector}`);
}

async function clickText(client, text, selector = "button, a") {
  const ok = await evaluate(
    client,
    `(() => {
      const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) =>
        node.textContent && node.textContent.trim() === ${JSON.stringify(text)}
      );
      if (!target) return false;
      target.click();
      return true;
    })()`
  );
  if (!ok) throw new Error(`Could not click ${text}`);
}

async function clickContainingText(client, text, selector = "button, a") {
  const ok = await evaluate(
    client,
    `(() => {
      const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) =>
        node.textContent && node.textContent.includes(${JSON.stringify(text)})
      );
      if (!target) return false;
      target.click();
      return true;
    })()`
  );
  if (!ok) throw new Error(`Could not click text containing ${text}`);
}

async function agentLoginAndCapture() {
  const client = await createClient(`${AGENT_BASE_URL}/agent/login`);
  try {
    console.log("Agent: opening login");
    await waitFor(client, "Boolean(document.querySelector('input[type=\"tel\"]'))");
    await setInputValue(client, 'input[type="tel"]', "+25766100001");
    await setInputValue(client, 'input[type="password"]', "123456");
    await clickText(client, "Sign In");
    await waitFor(client, "window.location.pathname !== '/agent/login'", 20000);
    await evaluate(client, `window.location.href = ${JSON.stringify(`${AGENT_BASE_URL}/agent/dashboard`)}`);
    await waitFor(client, "document.body && document.body.innerText.includes('Business Dashboard')", 20000);
    await waitFor(client, "document.body && document.body.innerText.includes('Net Remit Estimate')", 20000);
    await delay(1500);
    await capture(client, OUTPUTS.dashboard);
  } finally {
    await client.close();
  }
}

async function adminLoginAndCapture() {
  const client = await createClient(`${ADMIN_BASE_URL}/admin/login`);
  try {
    console.log("Admin: opening login");
    await waitFor(client, "Boolean(document.querySelector('input[type=\"email\"]')) || (document.body && document.body.innerText.includes('Use email login'))", 20000);
    const hasEmail = await evaluate(client, "Boolean(document.querySelector('input[type=\"email\"]'))");
    if (!hasEmail) {
      await clickContainingText(client, "Use email login");
      await waitFor(client, "Boolean(document.querySelector('input[type=\"email\"]'))");
    }
    await setInputValue(client, 'input[type="email"]', "seed.superadmin@kirimba.app");
    await setInputValue(client, 'input[type="password"]', "123456");
    await evaluate(client, `(() => {
      const form = document.querySelector("form");
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`);
    await waitFor(client, "window.location.pathname !== '/admin/login' && window.location.pathname !== '/login'", 20000);
    await evaluate(client, `window.location.href = ${JSON.stringify(`${ADMIN_BASE_URL}/admin/super/config`)}`);
    await waitFor(client, "document.body && document.body.innerText.includes('Pricing & Rules')", 20000);
    await waitFor(client, "document.body && document.body.innerText.includes('Live Agent Transaction Fees')", 20000);
    await delay(1000);
    await capture(client, OUTPUTS.fees);
    await clickText(client, "Commission Policy");
    await waitFor(client, "document.body && document.body.innerText.includes('Commission Policy View')", 20000);
    await delay(700);
    await capture(client, OUTPUTS.commission);
  } finally {
    await client.close();
  }
}

await agentLoginAndCapture();
await adminLoginAndCapture();
console.log(JSON.stringify(OUTPUTS, null, 2));
