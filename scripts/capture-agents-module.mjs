import fs from "node:fs/promises";

const BASE_URL = "http://127.0.0.1:5175";
const START_URL = `${BASE_URL}/admin/agents`;
const CDP_PORT = process.env.CDP_PORT || "9222";
const OUTPUTS = {
  kpi: "admin-agents-kpi.png",
  filters: "admin-agents-filters.png",
  queue: "admin-agents-queue.png",
  detail: "admin-agents-detail.png",
  suspended: "admin-agents-suspended.png",
  reactivated: "admin-agents-reactivated.png",
  empty: "admin-agents-empty.png",
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
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(message);
    return result;
  }

  async close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

async function launchTarget() {
  const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(START_URL)}`, { method: "PUT" });
  return new CdpClient(target.webSocketDebuggerUrl);
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

async function waitFor(client, predicate, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await evaluate(client, predicate);
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for predicate: ${predicate}`);
}

async function capture(client, filename) {
  await client.send("Page.bringToFront");
  await delay(300);
  const { data } = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await fs.writeFile(filename, Buffer.from(data, "base64"));
}

async function clickTextButton(client, text, selector = "button, a") {
  const escaped = JSON.stringify(text);
  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) =>
        node.textContent && node.textContent.trim() === ${escaped}
      );
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!clicked) {
    throw new Error(`Could not find clickable text: ${text}`);
  }
}

async function bodyText(client) {
  return String(await evaluate(client, "document.body ? document.body.innerText : ''"));
}

async function loginIfNeeded(client) {
  const pageText = await bodyText(client);
  if (pageText.includes("Agent queue")) return;
  if (!pageText.includes("KIRIMBA Admin")) {
    throw new Error(`Unexpected landing state: ${pageText.slice(0, 240)}`);
  }

  if (!(await evaluate(client, "Boolean(document.querySelector('input[type=\"email\"]'))"))) {
    await clickTextButton(client, "Use super admin email login");
    await waitFor(client, "Boolean(document.querySelector('input[type=\"email\"]'))");
  }

  await evaluate(
    client,
    `(() => {
      const setValue = (input, nextValue) => {
        const prototype = Object.getPrototypeOf(input);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor.set.call(input, nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };
      const email = document.querySelector('input[type="email"]');
      const pin = document.querySelector('input[type="password"]');
      setValue(email, "seed.superadmin@kirimba.app");
      setValue(pin, "123456");
      return true;
    })()`
  );

  await evaluate(
    client,
    `(() => {
      const form = document.querySelector("form");
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`
  );

  await waitFor(client, "window.location.pathname !== '/admin/login' && window.location.pathname !== '/login'", 20000);
}

async function scrollIntoViewByText(client, text) {
  const ok = await evaluate(
    client,
    `(() => {
      const node = [...document.querySelectorAll("section, h1, h2, h3, div")].find((item) =>
        item.textContent && item.textContent.includes(${JSON.stringify(text)})
      );
      if (!node) return false;
      node.scrollIntoView({ behavior: "instant", block: "start" });
      return true;
    })()`
  );
  if (!ok) throw new Error(`Could not scroll to text: ${text}`);
  await delay(350);
}

async function clickRowButton(client, rowTitleIncludes, buttonTextIncludes) {
  const clicked = await evaluate(
    client,
    `(() => {
      const rows = [...document.querySelectorAll("tbody tr")];
      const row = rows.find((node) => node.textContent && node.textContent.includes(${JSON.stringify(rowTitleIncludes)}));
      if (!row) return false;
      const button = [...row.querySelectorAll("button, a")].find((node) =>
        node.textContent && node.textContent.includes(${JSON.stringify(buttonTextIncludes)})
      );
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!clicked) {
    throw new Error(`Could not click "${buttonTextIncludes}" for row "${rowTitleIncludes}"`);
  }
}

async function setTextareaValue(client, selector, value) {
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
  if (!ok) throw new Error(`Could not set textarea ${selector}`);
}

async function applyEmptyFilter(client) {
  await evaluate(
    client,
    `(() => {
      const input = [...document.querySelectorAll('input[type="text"]')].find((node) =>
        node.placeholder && node.placeholder.includes("Agent, phone")
      );
      if (!input) return false;
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor.set.call(input, "NO_MATCH_AGENT_404");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
  await clickTextButton(client, "Apply filters");
}

async function clearFilters(client) {
  await clickTextButton(client, "Clear");
  await delay(400);
}

async function reloadAgentsPage(client) {
  await evaluate(client, "window.location.reload()");
  await waitFor(client, "document.readyState === 'complete'");
  await waitFor(client, "window.location.pathname === '/admin/agents'", 15000);
  await waitFor(client, "document.body.innerText.includes('Agent queue')", 20000);
  await waitFor(client, "document.querySelectorAll('tbody tr').length >= 1", 15000);
}

async function main() {
  const browserMeta = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  if (!browserMeta.webSocketDebuggerUrl) {
    throw new Error(`Chrome remote debugging is not available on 127.0.0.1:${CDP_PORT}`);
  }

  const client = await launchTarget();

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1600,
      height: 1400,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await waitFor(client, "document.readyState === 'complete'");
    await waitFor(client, "Boolean(document.body)");
    await waitFor(client, "!document.body.innerText.includes('Loading authentication...')", 20000);
    await loginIfNeeded(client);

    await evaluate(client, `window.location.href = ${JSON.stringify(START_URL)}`);
    await waitFor(client, "window.location.pathname === '/admin/agents'", 15000);
    await waitFor(client, "document.body.innerText.includes('Agent queue')", 20000);

    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await delay(400);
    await capture(client, OUTPUTS.kpi);

    await scrollIntoViewByText(client, "Filters");
    await capture(client, OUTPUTS.filters);

    await scrollIntoViewByText(client, "Agent queue");
    await waitFor(client, "document.querySelectorAll('tbody tr').length >= 1", 15000);
    await capture(client, OUTPUTS.queue);

    const firstAgentName = await evaluate(
      client,
      `(() => {
        const rows = [...document.querySelectorAll("tbody tr")];
        const target = rows.find((row) => row.textContent && row.textContent.includes("Suspend"));
        if (!target) return "";
        const first = target.querySelector("td button p");
        return first ? first.textContent.trim() : "";
      })()`
    );
    if (!firstAgentName) {
      console.log(await bodyText(client));
      throw new Error("Could not find an active agent row with suspend control.");
    }
    await clickRowButton(client, firstAgentName, "Detail");
    await waitFor(client, "document.body.innerText.includes('Agent summary')", 10000);
    await capture(client, OUTPUTS.detail);

    await clickTextButton(client, "Close");
    await waitFor(client, "!document.body.innerText.includes('Agent summary')", 10000);
    await clickRowButton(client, firstAgentName, "Suspend");
    await waitFor(client, `Boolean(document.querySelector('textarea[placeholder="Operational or compliance reason for the suspension"]'))`, 10000);
    await setTextareaValue(client, 'textarea[placeholder="Operational or compliance reason for the suspension"]', "QA lifecycle capture suspension.");
    await clickTextButton(client, "Confirm suspension");
    await delay(2500);
    await reloadAgentsPage(client);
    await clickRowButton(client, firstAgentName, "Detail");
    await waitFor(client, "document.body.innerText.includes('Reactivate agent')", 10000);
    await capture(client, OUTPUTS.suspended);

    await clickTextButton(client, "Reactivate agent");
    await waitFor(client, `Boolean([...document.querySelectorAll('button')].find((node) => node.textContent && node.textContent.trim() === 'Confirm reactivation'))`, 10000);
    await clickTextButton(client, "Confirm reactivation");
    await delay(2500);
    await reloadAgentsPage(client);
    await clickRowButton(client, firstAgentName, "Detail");
    await waitFor(client, "document.body.innerText.includes('Suspend agent')", 10000);
    await capture(client, OUTPUTS.reactivated);

    await clickTextButton(client, "Close");
    await waitFor(client, "!document.body.innerText.includes('Agent summary')", 10000);
    await scrollIntoViewByText(client, "Filters");
    await applyEmptyFilter(client);
    await waitFor(client, "document.body.innerText.includes('No agents match the current filters.')", 10000);
    await capture(client, OUTPUTS.empty);
    await clearFilters(client);

    console.log("Saved screenshots:");
    Object.values(OUTPUTS).forEach((file) => console.log(`- ${file}`));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
