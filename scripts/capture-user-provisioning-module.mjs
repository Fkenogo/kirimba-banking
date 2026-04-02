import fs from "node:fs/promises";

const BASE_URL = "http://127.0.0.1:5175";
const START_URL = `${BASE_URL}/admin/super/provisioning`;
const CDP_PORT = process.env.CDP_PORT || "9222";
const OUTPUTS = {
  kpi: "admin-user-provisioning-kpi.png",
  filters: "admin-user-provisioning-filters.png",
  queue: "admin-user-provisioning-queue.png",
  create: "admin-user-provisioning-create.png",
  detail: "admin-user-provisioning-detail.png",
  acceptance: "admin-user-provisioning-acceptance.png",
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed ${response.status} for ${url}`);
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
  if (pageText.includes("Invitation queue")) return;
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
      setValue(document.querySelector('input[type="email"]'), "seed.superadmin@kirimba.app");
      setValue(document.querySelector('input[type="password"]'), "123456");
      document.querySelector("form")?.requestSubmit();
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

async function chooseCreateRole(client, role) {
  const result = await evaluate(
    client,
    `(() => {
      const selects = [...document.querySelectorAll('select')];
      const roleSelect = selects.find((node) => node.options[0]?.textContent?.includes("Select invitation role"));
      if (!roleSelect) return false;
      roleSelect.value = ${JSON.stringify(role)};
      roleSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
  if (!result) throw new Error("Could not set the invitation role.");
}

async function fillCreateForm(client, inviteName, invitePhone) {
  const result = await evaluate(
    client,
    `(() => {
      const setValue = (input, nextValue) => {
        const prototype = Object.getPrototypeOf(input);
        const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
        descriptor.set.call(input, nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const nameInput = [...document.querySelectorAll('input[type="text"]')].find((node) => node.placeholder === "Full name");
      const phoneInput = [...document.querySelectorAll('input[type="tel"]')].find((node) => node.placeholder === "+25766123456");
      const institutionSelect = [...document.querySelectorAll('select')].find((node) => node.options[0]?.textContent?.includes("Select institution"));
      if (!nameInput || !phoneInput || !institutionSelect) return { ok: false, reason: "inputs" };

      setValue(nameInput, ${JSON.stringify(inviteName)});
      setValue(phoneInput, ${JSON.stringify(invitePhone)});
      const firstInstitution = [...institutionSelect.options].find((option) => option.value);
      if (!firstInstitution) return { ok: false, reason: "institution-option" };
      institutionSelect.value = firstInstitution.value;
      institutionSelect.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    })()`
  );
  if (!result?.ok) throw new Error(`Could not populate create form (${result?.reason || "unknown"}).`);
}

async function clickRowButton(client, rowText, buttonText) {
  const clicked = await evaluate(
    client,
    `(() => {
      const row = [...document.querySelectorAll("tbody tr")].find((node) =>
        node.textContent && node.textContent.includes(${JSON.stringify(rowText)})
      );
      if (!row) return false;
      const button = [...row.querySelectorAll("button")].find((node) =>
        node.textContent && node.textContent.includes(${JSON.stringify(buttonText)})
      );
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!clicked) throw new Error(`Could not click ${buttonText} for ${rowText}`);
}

async function extractAcceptanceLink(client) {
  const link = await evaluate(
    client,
    `(() => {
      const node = [...document.querySelectorAll("p")].find((item) =>
        item.textContent && item.textContent.includes("/admin/invitations/accept")
      );
      return node ? node.textContent.trim() : "";
    })()`
  );
  if (!link) throw new Error("Could not find acceptance link in the success dialog.");
  return link;
}

async function submitVisibleForm(client) {
  const submitted = await evaluate(
    client,
    `(() => {
      const forms = [...document.querySelectorAll("form")];
      const dialogForm = forms.find((form) => form.closest('[class*="fixed inset-0"]'));
      if (!dialogForm) return false;
      dialogForm.requestSubmit();
      return true;
    })()`
  );
  if (!submitted) throw new Error("Could not submit the invitation form.");
}

function buildInvitePhone() {
  const suffix = String(Date.now()).slice(-5);
  return `+25766${suffix.padStart(6, "0").slice(0, 6)}`;
}

async function main() {
  const browserMeta = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/version`);
  if (!browserMeta.webSocketDebuggerUrl) {
    throw new Error(`Chrome remote debugging is not available on 127.0.0.1:${CDP_PORT}`);
  }

  const client = await launchTarget();
  const inviteName = `Invite Demo Agent ${String(Date.now()).slice(-4)}`;
  const invitePhone = buildInvitePhone();

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
    await waitFor(client, "window.location.pathname === '/admin/super/provisioning'", 15000);
    await waitFor(client, "document.body.innerText.includes('Invitation queue')", 20000);

    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await delay(500);
    await capture(client, OUTPUTS.kpi);

    await scrollIntoViewByText(client, "Filters");
    await capture(client, OUTPUTS.filters);

    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await clickTextButton(client, "Create invitation");
    await waitFor(client, "document.body.innerText.includes('Create user invitation')", 10000);
    await chooseCreateRole(client, "agent");
    await waitFor(client, "document.body.innerText.includes('This role uses the Agent Console') || document.body.innerText.includes('This role uses the Agent console')", 10000);
    await fillCreateForm(client, inviteName, invitePhone);
    await capture(client, OUTPUTS.create);

    await submitVisibleForm(client);
    await waitFor(client, "document.body.innerText.includes('Invitation ready to share')", 15000);
    const acceptanceLink = await extractAcceptanceLink(client);
    await clickTextButton(client, "Close");
    await waitFor(client, "!document.body.innerText.includes('Invitation ready to share')", 10000);

    await waitFor(client, `document.body.innerText.includes(${JSON.stringify(inviteName)})`, 15000);
    await scrollIntoViewByText(client, "Invitation queue");
    await capture(client, OUTPUTS.queue);

    await clickRowButton(client, inviteName, "Detail");
    await waitFor(client, "document.body.innerText.includes('Invitation lifecycle')", 10000);
    await evaluate(client, "window.scrollTo({ top: 0, behavior: 'instant' })");
    await delay(400);
    await capture(client, OUTPUTS.detail);
    await clickTextButton(client, "Close");

    await client.send("Page.navigate", { url: acceptanceLink });
    await waitFor(client, "window.location.pathname === '/admin/invitations/accept'", 15000);
    await waitFor(client, "document.body.innerText.includes('Accept your access invitation')", 15000);
    await capture(client, OUTPUTS.acceptance);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
