/**
 * Capture README screenshots using demo accounts only (no real personal data).
 * Run: node scripts/capture_screenshots.mjs
 */
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.KINDER_URL || "http://localhost:8487";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");

async function api(pathname, options = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${options.method || "GET"} ${pathname} -> ${res.status}: ${body}`);
  }
  return res.json();
}

function resetDemoData() {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    execSync("docker compose run --rm babynames python scripts/strip_user_data.py", {
      cwd: root,
      stdio: "pipe",
    });
  } catch {
    // Ignore when Docker is unavailable; setup may still work on a fresh database.
  }
}

async function setupDemoMatches() {
  const alex = await api("/api/auth", {
    method: "POST",
    body: JSON.stringify({ email: "alex@example.com" }),
  });
  await api("/api/me/name", {
    method: "POST",
    body: JSON.stringify({ user_id: alex.id, name: "Alex" }),
  });

  const { invite_url } = await api("/api/invite", {
    method: "POST",
    body: JSON.stringify({ user_id: alex.id }),
  });
  const token = new URL(invite_url).searchParams.get("invite");

  const sam = await api(`/api/invite/${token}/accept`, {
    method: "POST",
    body: JSON.stringify({ email: "sam@example.com", name: "Sam" }),
  });

  const liked = [];
  for (let i = 0; i < 3; i++) {
    const next = await api(`/api/next-name?user_id=${alex.id}`);
    if (!next?.id) break;
    const body = { user_id: alex.id, status: 1 };
    if (next.custom) body.custom_id = next.id;
    else body.name_id = next.id;
    await api("/api/swipe", { method: "POST", body: JSON.stringify(body) });
    liked.push(next);
  }

  for (const name of liked) {
    const body = { user_id: sam.id, status: 1 };
    if (name.custom) body.custom_id = name.id;
    else body.name_id = name.id;
    await api("/api/swipe", { method: "POST", body: JSON.stringify(body) });
  }

  return { alex, sam };
}

async function capture() {
  await mkdir(OUT, { recursive: true });
  resetDemoData();
  await setupDemoMatches();

  const browser = await chromium.launch();
  const viewport = { width: 390, height: 844 };
  const deviceScaleFactor = 2;

  async function newPage() {
    const context = await browser.newContext({ viewport, deviceScaleFactor });
    return context.newPage();
  }

  async function signIn(page, email) {
    await page.goto(BASE);
    const signInVisible = await page.locator("#sign-in-screen:not(.hidden)").isVisible();
    if (signInVisible) {
      await page.fill("#email-input", email);
      await page.click("#sign-in-form .sign-in-btn");
    }
    await page.waitForSelector("#app:not(.hidden)");
  }

  // Sign-in screen (no email entered)
  {
    const page = await newPage();
    await page.goto(BASE);
    await page.waitForSelector("#sign-in-screen:not(.hidden)");
    await page.screenshot({ path: path.join(OUT, "sign-in.png") });
    await page.context().close();
  }

  // Swipe screen
  {
    const page = await newPage();
    await signIn(page, "alex@example.com");
    await page.waitForSelector("#name-card:not(.hidden)", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, "swipe.png") });
    await page.context().close();
  }

  // Matches screen
  {
    const page = await newPage();
    await signIn(page, "alex@example.com");
    await page.click("#nav-matches");
    await page.waitForSelector("#tab-matches:not(.hidden)");
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "matches.png") });
    await page.context().close();
  }

  await browser.close();
  console.log(`Screenshots saved to ${OUT}`);
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
