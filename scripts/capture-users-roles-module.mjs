import fs from "node:fs/promises";

const BASE_URL = "http://127.0.0.1:5175";
const START_URL = `${BASE_URL}/admin/super/admins`;
const CDP_PORT = process.env.CDP_PORT || "9222";
const OUTPUTS = {
  kpi: "admin-users-roles-kpi.png",
  filters: "admin-users-roles-filters.png",
  queue: "admin-users-roles-queue.png",
  detail: "admin-users-roles-detail.png",
  empty: "admin-users-roles-empty.png",
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
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async close() {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

async function launchTarget() {
  const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(START_URL)}`, {
    method: "PUT",
  });
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
  const clicked = await evaluate(
    client,
    `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) =>
        item.textContent && item.textContent.trim() === ${JSON.stringify(text)}
      );
      if (!node) return false;
      node.click();
      return true;
    })()`
  );
  if (!clicked) throw new Error(`Could not find clickable text: ${text}`);
}

async function bodyText(client) {
  return String(await evaluate(client, "document.body ? document.body.innerText : ''"));
}

async function loginIfNeeded(client) {
  const pageText = await bodyText(client);
  if (pageText.includes("Access queue")) return;
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

async function clickFirstDetailButton(client) {
  const clicked = await evaluate(
    client,
    `(() => {
      const rows = [...document.querySelectorAll("tbody tr")];
      if (!rows.length) return false;
      const button = [...rows[0].querySelectorAll("button")].find((item) => item.textContent && item.textContent.includes("Detail"));
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!clicked) throw new Error("Could not open the first detail drawer.");
}

async function applyEmptyFilter(client) {
  const updated = await evaluate(
    client,
    `(() => {
      const input = [...document.querySelectorAll('input[type="text"]')].find((item) =>
        item.placeholder && item.placeholder.includes("member ID")
      );
      if (!input) return false;
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor.set.call(input, "NO_MATCH_USER_404");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
  if (!updated) throw new Error("Could not set the empty-state filter.");
  await clickTextButton(client, "Apply filters");
}

async function clearFilters(client) {
  await clickTextButton(client, "Clear");
  await delay(500);
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
      height: 1600,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await client.send("Page.navigate", { url: START_URL });
    await waitFor(client, "document.readyState === 'complete'");
    await waitFor(client, "Boolean(document.body)");
    await waitFor(client, "!document.body.innerText.includes('Loading authentication...')", 20000);
    await loginIfNeeded(client);

    await evaluate(client, `window.location.href = ${JSON.stringify(START_URL)}`);
    await waitFor(client, "window.location.pathname === '/admin/super/admins'", 15000);
    await waitFor(client, "document.body.innerText.includes('Access queue')", 20000);

    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await delay(400);
    await capture(client, OUTPUTS.kpi);

    await scrollIntoViewByText(client, "Filters");
    await capture(client, OUTPUTS.filters);

    await scrollIntoViewByText(client, "Access queue");
    await capture(client, OUTPUTS.queue);

    await clickFirstDetailButton(client);
    await waitFor(client, "document.body.innerText.includes('Role and status')", 15000);
    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await delay(400);
    await capture(client, OUTPUTS.detail);

    await clickTextButton(client, "Close");
    await delay(300);
    await scrollIntoViewByText(client, "Filters");
    await applyEmptyFilter(client);
    await waitFor(client, "document.body.innerText.includes('No user accounts match the current filters.')", 15000);
    await capture(client, OUTPUTS.empty);
    await clearFilters(client);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
