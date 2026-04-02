import fs from "node:fs/promises";

const BASE_URL = "http://127.0.0.1:5175";
const LOGIN_URL = `${BASE_URL}/admin/login`;
const CDP_PORT = process.env.CDP_PORT || "9222";
const OUTPUTS = {
  fund: "admin-fund-management-validated.png",
  economics: "admin-loan-portfolio-term-economics.png",
  pricingError: "admin-pricing-validation-error.png",
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
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) =>
        node.textContent && node.textContent.trim() === ${JSON.stringify(text)}
      );
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
  if (!clicked) throw new Error(`Could not find clickable text: ${text}`);
}

async function navigate(client, pathname) {
  await client.send("Page.navigate", { url: `${BASE_URL}${pathname}` });
  await waitFor(client, `window.location.pathname === ${JSON.stringify(pathname)}`);
  await delay(800);
}

async function loginIfNeeded(client) {
  await waitFor(client, "document.readyState === 'complete'");
  const pageText = await evaluate(client, "document.body ? document.body.innerText : ''");
  if (!pageText.includes("KIRIMBA Admin")) return;

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
  await delay(1200);
}

async function scrollToText(client, text) {
  await evaluate(
    client,
    `(() => {
      const node = [...document.querySelectorAll("section, h1, h2, h3, div, p")].find((item) =>
        item.textContent && item.textContent.includes(${JSON.stringify(text)})
      );
      if (!node) return false;
      node.scrollIntoView({ behavior: "instant", block: "start" });
      return true;
    })()`
  );
  await delay(300);
}

async function setTextareaValue(client, value) {
  const ok = await evaluate(
    client,
    `(() => {
      const input = document.querySelector("textarea");
      if (!input) return false;
      const prototype = Object.getPrototypeOf(input);
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      descriptor.set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`
  );
  if (!ok) throw new Error("Could not set config textarea value.");
}

async function buildInvalidLoanPolicyDraft(client) {
  return evaluate(
    client,
    `(() => {
      const textarea = document.querySelector("textarea");
      if (!textarea) return null;
      const value = JSON.parse(textarea.value);
      value.termPricing = value.termPricing.map((term) => {
        if (Number(term.durationDays) === 14) {
          return { ...term, contractedFeePct: 0.02 };
        }
        return term;
      });
      return JSON.stringify(value, null, 2);
    })()`
  );
}

async function main() {
  const target = await fetchJson(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(LOGIN_URL)}`, { method: "PUT" });
  const client = new CdpClient(target.webSocketDebuggerUrl);

  try {
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await loginIfNeeded(client);

    await navigate(client, "/admin/super/fund");
    try {
      await waitFor(client, "document.body && (document.body.innerText.includes('Kirimba Fund Management') || document.body.innerText.includes('Access Restricted'))", 30000);
    } catch (error) {
      const currentText = await evaluate(client, "document.body ? document.body.innerText : ''");
      throw new Error(`${error.message}\nCurrent fund page text:\n${currentText.slice(0, 800)}`);
    }
    const fundBody = await evaluate(client, "document.body ? document.body.innerText : ''");
    if (fundBody.includes("Access Restricted")) {
      throw new Error(`Fund screen is access restricted: ${fundBody.slice(0, 400)}`);
    }
    await capture(client, OUTPUTS.fund);

    await navigate(client, "/admin/super/loans");
    await waitFor(client, "document.body && (document.body.innerText.includes('Loan Portfolio') || document.body.innerText.includes('Access Restricted'))", 30000);
    await delay(1500);
    const portfolioBody = await evaluate(client, "document.body ? document.body.innerText : ''");
    if (portfolioBody.includes("Access Restricted")) {
      throw new Error(`Portfolio screen is access restricted: ${portfolioBody.slice(0, 400)}`);
    }
    if (!portfolioBody.toLowerCase().includes("term economics")) {
      throw new Error(`Term Economics block did not render:\n${portfolioBody.slice(0, 1600)}`);
    }
    await scrollToText(client, "TERM ECONOMICS");
    await capture(client, OUTPUTS.economics);

    await navigate(client, "/admin/super/config");
    await waitFor(client, "document.body && (document.body.innerText.includes('Pricing & Rules') || document.body.innerText.includes('Access Restricted'))");
    const configBody = await evaluate(client, "document.body ? document.body.innerText : ''");
    if (configBody.includes("Access Restricted")) {
      throw new Error(`Pricing screen is access restricted: ${configBody.slice(0, 400)}`);
    }
    await clickTextButton(client, "Loan Policy");
    await delay(400);
    const invalidDraft = await buildInvalidLoanPolicyDraft(client);
    if (!invalidDraft) throw new Error("Could not derive invalid loan policy draft.");
    await setTextareaValue(client, invalidDraft);
    await clickTextButton(client, "Save Changes");
    await waitFor(client, "document.body && document.body.innerText.includes('14-day contractedFeePct must be higher than 7-day pricing.')");
    await scrollToText(client, "14-day contractedFeePct must be higher than 7-day pricing.");
    await capture(client, OUTPUTS.pricingError);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
