import fs from "node:fs/promises";

const BASE_URL = "http://127.0.0.1:5175";
const START_URL = `${BASE_URL}/admin/super/institutions`;
const CDP_PORT = process.env.CDP_PORT || "9222";
const OUTPUTS = {
  kpi: "admin-institutions-kpi.png",
  filters: "admin-institutions-filters.png",
  queue: "admin-institutions-queue.png",
  detail: "admin-institutions-detail.png",
  empty: "admin-institutions-empty.png",
  create: "admin-institutions-create.png",
  success: "admin-institutions-success.png",
  cta: "admin-institutions-invite-cta.png",
  provisioning: "admin-user-provisioning-prefill.png",
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
  if (pageText.includes("Institution queue")) return;
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

async function applyEmptyFilter(client) {
  await evaluate(
    client,
    `(() => {
      const input = [...document.querySelectorAll('input[type="text"]')].find((node) =>
        node.placeholder && node.placeholder.includes("Institution name")
      );
      if (!input) return false;
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor.set.call(input, "NO_MATCH_INSTITUTION_404");
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

async function setTextareaValue(client, selector, value) {
  await setInputValue(client, selector, value);
}

async function setCheckboxValue(client, labelText, checked) {
  const ok = await evaluate(
    client,
    `(() => {
      const label = [...document.querySelectorAll("label")].find((node) => node.textContent && node.textContent.includes(${JSON.stringify(labelText)}));
      if (!label) return false;
      const input = label.querySelector('input[type="checkbox"]');
      if (!input) return false;
      if (input.checked !== ${checked ? "true" : "false"}) {
        input.click();
      }
      return input.checked === ${checked ? "true" : "false"};
    })()`
  );
  if (!ok) throw new Error(`Could not set checkbox ${labelText}`);
}

async function setSelectByLabel(client, labelText, value) {
  const ok = await evaluate(
    client,
    `(() => {
      const modal = [...document.querySelectorAll(".fixed")].at(-1) || document;
      const label = [...modal.querySelectorAll("label")].find((node) => node.textContent && node.textContent.includes(${JSON.stringify(labelText)}));
      if (!label) return false;
      const select = label.querySelector("select");
      if (!select) return false;
      select.value = ${JSON.stringify(value)};
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return select.value === ${JSON.stringify(value)};
    })()`
  );
  if (!ok) throw new Error(`Could not set select ${labelText}`);
}

async function submitOpenForm(client) {
  const ok = await evaluate(
    client,
    `(() => {
      const modal = [...document.querySelectorAll(".fixed")].at(-1) || document;
      const form = modal.querySelector("form");
      if (!form) return false;
      form.requestSubmit();
      return true;
    })()`
  );
  if (!ok) throw new Error("Could not submit the open form");
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
    await waitFor(client, "window.location.pathname === '/admin/super/institutions'", 15000);
    await waitFor(client, "document.body.innerText.includes('Institution queue')", 20000);

    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await delay(400);
    await capture(client, OUTPUTS.kpi);

    await scrollIntoViewByText(client, "Filters");
    await capture(client, OUTPUTS.filters);

    await scrollIntoViewByText(client, "Institution queue");
    await waitFor(client, "document.querySelectorAll('tbody tr').length >= 1", 15000);
    await capture(client, OUTPUTS.queue);

    await clickRowButton(client, "", "Detail");
    await waitFor(client, "document.body.innerText.includes('Institution summary')", 10000);
    await capture(client, OUTPUTS.detail);

    await clickTextButton(client, "Close");
    await waitFor(client, "!document.body.innerText.includes('Institution summary')", 10000);

    const suffix = `${Date.now()}`.slice(-6);
    const institutionName = `Onboarding Credit ${suffix}`;
    const institutionCode = `ONB${suffix}`;
    const contactEmail = `ops+${suffix}@kirimba.app`;

    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await delay(300);
    await clickTextButton(client, "Create institution");
    await waitFor(client, `Boolean(document.querySelector('input[placeholder="Partner institution name"]'))`, 10000);
    await capture(client, OUTPUTS.create);

    await setInputValue(client, 'input[placeholder="Partner institution name"]', institutionName);
    await setInputValue(client, 'input[placeholder="Short code"]', institutionCode);
    await setInputValue(client, 'input[placeholder="Microfinance, SACCO, bank"]', "Microfinance");
    await setSelectByLabel(client, "Country", "RW");
    await setInputValue(client, 'input[placeholder="Primary contact"]', "Aline Mukamana");
    await setInputValue(client, 'input[placeholder="Optional contact email"]', contactEmail);
    await setInputValue(client, 'input[placeholder="+25766123456"]', "+250788123456");
    await setInputValue(client, 'input[placeholder="Optional prefix"]', `RW${suffix}`);
    await setTextareaValue(client, 'textarea[placeholder="Operational notes"]', "Created through admin onboarding flow QA.");
    await setCheckboxValue(client, "Loans", true);

    await submitOpenForm(client);
    await waitFor(client, "document.body.innerText.includes('Institution created') && document.body.innerText.includes('Invite first institution user')", 15000);
    await capture(client, OUTPUTS.success);

    await scrollIntoViewByText(client, "Next step");
    await capture(client, OUTPUTS.cta);

    await clickTextButton(client, "Invite first institution user");
    await waitFor(client, "window.location.pathname === '/admin/super/provisioning'", 15000);
    await waitFor(client, "document.body.innerText.includes('Create user invitation')", 15000);
    await waitFor(client, `(() => {
      const roleSelect = [...document.querySelectorAll("select")].find((node) => node.value === "institution_user");
      const institutionSelect = [...document.querySelectorAll("select")].find((node) => node.value && node.value !== "institution_user");
      return Boolean(roleSelect && institutionSelect);
    })()`, 15000);
    await capture(client, OUTPUTS.provisioning);

    await evaluate(client, "window.location.href = 'http://127.0.0.1:5175/admin/super/institutions'");
    await waitFor(client, "window.location.pathname === '/admin/super/institutions'", 15000);
    await waitFor(client, "document.body.innerText.includes('Institution queue')", 15000);
    await scrollIntoViewByText(client, "Filters");
    await applyEmptyFilter(client);
    await waitFor(client, "document.body.innerText.includes('No institutions match the current filters.')", 10000);
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
