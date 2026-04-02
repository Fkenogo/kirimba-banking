import fs from "node:fs/promises";

const BASE_URL = "http://127.0.0.1:5175";
const START_URL = `${BASE_URL}/admin/operations/risk-exceptions`;
const CDP_PORT = process.env.CDP_PORT || "9222";
const OUTPUTS = {
  queue: "admin-risk-qa-queue.png",
  drawer: "admin-risk-qa-drawer.png",
  depositsCta: "admin-risk-qa-cta-deposits.png",
  reconciliationCta: "admin-risk-qa-cta-reconciliation.png",
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

async function clickTextButton(client, text) {
  const escaped = JSON.stringify(text);
  const clicked = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('button, a')].find((node) =>
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

async function clickRowButton(client, rowTitleIncludes, buttonTextIncludes) {
  const clicked = await evaluate(
    client,
    `(() => {
      const rows = [...document.querySelectorAll('tbody tr')];
      const row = rows.find((node) => node.textContent && node.textContent.includes(${JSON.stringify(rowTitleIncludes)}));
      if (!row) return false;
      const button = [...row.querySelectorAll('button, a')].find((node) =>
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
      height: 1200,
      deviceScaleFactor: 1,
      mobile: false,
    });

    await waitFor(client, "document.readyState === 'complete'");
    await waitFor(client, "Boolean(document.body)");
    await waitFor(client, "!document.body.innerText.includes('Loading authentication...')", 20000);

    const pageText = await bodyText(client);
    if (!pageText.includes("Intervention queue")) {
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
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            descriptor.set.call(input, nextValue);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const email = document.querySelector('input[type="email"]');
          const pin = document.querySelector('input[type="password"]');
          setValue(email, 'seed.superadmin@kirimba.app');
          setValue(pin, '123456');
          return true;
        })()`
      );

      await evaluate(
        client,
        `(() => {
          const form = document.querySelector('form');
          if (!form) return false;
          form.requestSubmit();
          return true;
        })()`
      );

      await delay(800);
      const postSubmitText = await bodyText(client);
      if (postSubmitText.includes("Authentication failed") || postSubmitText.includes("unreachable")) {
        throw new Error(`Login failed: ${postSubmitText.slice(0, 320)}`);
      }

      await waitFor(client, "window.location.pathname !== '/login'", 20000);
    }

    await evaluate(client, `window.location.href = ${JSON.stringify(START_URL)}`);
    await waitFor(client, "window.location.pathname === '/admin/operations/risk-exceptions'", 15000);
    await waitFor(client, "document.body.innerText.includes('Intervention queue')", 15000);
    await waitFor(client, "document.querySelectorAll('tbody tr').length >= 5", 15000);

    await capture(client, OUTPUTS.queue);

    await clickRowButton(client, "Flagged batch", "Detail");
    await waitFor(client, "document.body.innerText.includes('Source module handoff')", 10000);
    await capture(client, OUTPUTS.drawer);

    await clickTextButton(client, "Open in Deposits & Batches");
    await waitFor(client, "window.location.pathname === '/admin/deposits/pending'", 10000);
    await waitFor(
      client,
      "document.body.innerText.includes('Deposits & Batches') || document.body.innerText.includes('Pending batches')",
      10000
    );
    await capture(client, OUTPUTS.depositsCta);

    await evaluate(client, `window.location.href = ${JSON.stringify(START_URL)}`);
    await waitFor(client, "window.location.pathname === '/admin/operations/risk-exceptions'", 10000);
    await waitFor(client, "document.querySelectorAll('tbody tr').length >= 5", 10000);
    await clickRowButton(client, "Flagged reconciliation", "Open in Reconciliation & Settlements");
    await waitFor(client, "window.location.pathname === '/admin/operations/reconciliation-settlements'", 10000);
    await waitFor(client, "window.location.search.includes('focus=mismatch')", 10000);
    await waitFor(client, "document.body.innerText.includes('Mismatch Queue')", 10000);
    await capture(client, OUTPUTS.reconciliationCta);

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
