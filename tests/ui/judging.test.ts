import assert from "node:assert/strict";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createSecureServer } from "node:https";
import { request as proxyRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { asc, eq } from "drizzle-orm";
import { assessments, hackathonEvents, organizerUsers, rubricVersions, submissions } from "../../src/db/schema";
import { addRubric } from "../../src/lib/event-service";
import { finalizeReview } from "../../src/lib/evaluation/finalize";
import { listReviews } from "../../src/lib/evaluation/reviews";
import { AI_PIPELINE_VERSION } from "../../src/lib/evaluation/versions";
import { hashPassword } from "../../src/lib/password";
import { claimJob, processJob, queueEvaluation } from "../../src/lib/jobs";
import { isolatedDatabase } from "../helpers/database";
import { SHA } from "../helpers/github";
import { modelDraft, modelOptions } from "../helpers/model";
import { sourceFixture } from "../helpers/source";

test("browser: management UX, human review, AG Grid and actual AG Studio reports", { timeout: 240_000 }, async () => {
  const fixture = await isolatedDatabase();
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let proxy: ReturnType<typeof createSecureServer> | undefined;
  const certificates = await mkdtemp(join(tmpdir(), "hackref-browser-tls-"));
  try {
    const password = randomBytes(24).toString("base64url");
    const [organizer] = await fixture.db.insert(organizerUsers).values({ email: "browser@example.test", displayName: "Browser reviewer", passwordHash: await hashPassword(password) }).returning();
    const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address === "object");
    const port = address.port; await new Promise<void>((resolve) => server.close(() => resolve()));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(certificates, "key.pem"), "-out", join(certificates, "cert.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
    proxy = createSecureServer({ key: await readFile(join(certificates, "key.pem")), cert: await readFile(join(certificates, "cert.pem")) }, (incoming, outgoing) => {
      const upstream = proxyRequest({ hostname: "127.0.0.1", port, path: incoming.url, method: incoming.method, headers: incoming.headers }, (response) => { outgoing.writeHead(response.statusCode ?? 503, response.headers); response.pipe(outgoing); });
      upstream.on("error", () => { outgoing.writeHead(503); outgoing.end(); }); incoming.pipe(upstream);
    });
    proxy.listen(0, "127.0.0.1"); await once(proxy, "listening");
    const proxyAddress = proxy.address(); assert.ok(proxyAddress && typeof proxyAddress === "object");
    const base = `https://127.0.0.1:${proxyAddress.port}`;
    child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: fixture.connectionString, SESSION_PASSWORD: randomBytes(48).toString("hex"), APP_ORIGIN: base, AG_STUDIO_LICENSE_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.resume(); child.stderr?.resume();
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error("Build the production app before browser tests.");
      try { if ((await fetch(`http://127.0.0.1:${port}/login`)).ok) { ready = true; break; } } catch { /* startup */ }
      await delay(100);
    }
    assert.ok(ready, "Production server failed to start.");
    browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, ignoreHTTPSErrors: true });
    await mkdir("test-results", { recursive: true });
    const runtimeErrors: string[] = [];
    const failedAssets: string[] = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("response", (response) => { if (response.url().includes("/_next/") && response.status() >= 400) failedAssets.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    page.on("requestfailed", (request) => { if (request.url().includes("/_next/")) failedAssets.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`); });
    await page.goto(`${base}/login`);
    assert.deepEqual(failedAssets, [], "Production browser assets must load.");
    await page.getByLabel("Email", { exact: true }).fill("browser@example.test");
    await page.getByLabel("Password", { exact: true }).fill(password);
    const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/login") && response.request().method() === "POST", { timeout: 10_000 });
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    assert.deepEqual(runtimeErrors, [], "Login must hydrate without browser errors.");
    const loggedIn = await loginResponse;
    assert.equal(loggedIn.status(), 200, "Browser login must succeed over the local TLS proxy.");
    await page.waitForURL("**/submissions");
    // All writes in this scenario target the disposable test schema, never the application database.
    await page.goto(`${base}/event`);
    await page.getByLabel("Event name", { exact: true }).fill("Café Browser: Test 2026!");
    await expect(page.getByLabel("Event slug", { exact: true })).toHaveValue("cafe-browser-test-2026");
    await page.getByLabel("Event slug", { exact: true }).fill("Browser_bad");
    await expect(page.getByText(/Spaces, underscores and leading/)).toBeVisible();
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    assert.equal((await fixture.db.select().from(hackathonEvents)).length, 0);
    await page.getByLabel("Event slug", { exact: true }).fill("browser-test");
    await page.getByLabel("Event name", { exact: true }).fill("Browser test event");
    await expect(page.getByLabel("Event slug", { exact: true })).toHaveValue("browser-test");
    await page.getByLabel("Deadline (UTC)", { exact: true }).fill("2026-11-12T20:59");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(page.getByText("Event saved.", { exact: true })).toBeVisible();
    const [event] = await fixture.db.select().from(hackathonEvents);
    await page.reload();
    await page.getByLabel("Event name", { exact: true }).fill("Renamed browser event");
    await expect(page.getByLabel("Event slug", { exact: true })).toHaveValue("browser-test");
    await page.getByRole("button", { name: "Save event", exact: true }).click();
    await expect(page.getByText("Event saved.", { exact: true })).toBeVisible();
    const [renamed] = await fixture.db.select().from(hackathonEvents);
    assert.equal(renamed.id, event.id); assert.equal(renamed.slug, "browser-test");
    // Prove that publication appends one four-criterion version and preserves all v1–v4 snapshots.
    for (let version = 1; version <= 4; version++) await addRubric(fixture.db, organizer.id, { title: `Historical rubric ${version}`, criteria: [{ key: version === 4 ? "q".repeat(40) : "quality", label: version === 4 ? "Q".repeat(120) : "Quality", maxScore: 10 }] });
    const snapshots = await fixture.db.select().from(rubricVersions).orderBy(asc(rubricVersions.version));
    await page.reload();
    await page.getByLabel("Rubric title", { exact: true }).fill("Browser rubric");
    const criterionRows = page.locator("fieldset").filter({ has: page.locator("legend") });
    await criterionRows.nth(0).getByLabel("Criterion label", { exact: true }).fill("Quality");
    await expect(criterionRows.nth(0).getByLabel("Criterion key", { exact: true })).toHaveValue("quality");
    await criterionRows.nth(0).getByLabel("Criterion key", { exact: true }).fill("stable_quality");
    await criterionRows.nth(0).getByLabel("Criterion label", { exact: true }).fill("Engineering quality");
    await expect(criterionRows.nth(0).getByLabel("Criterion key", { exact: true })).toHaveValue("stable_quality");
    await criterionRows.nth(0).getByLabel("Criterion key", { exact: true }).fill("quality");
    await criterionRows.nth(0).getByLabel("Criterion label", { exact: true }).fill("Quality");
    for (const [index, label] of ["Clarity", "Usability", "Originality"].entries()) {
      await page.getByRole("button", { name: "Add criterion", exact: true }).click();
      await criterionRows.nth(index + 1).getByLabel("Criterion label", { exact: true }).fill(label);
    }
    await criterionRows.nth(1).getByLabel("Criterion key", { exact: true }).fill("quality");
    await expect(page.getByText("This key is already used.", { exact: false })).toHaveCount(2);
    await page.getByRole("button", { name: "Review publication", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await criterionRows.nth(1).getByLabel("Criterion key", { exact: true }).fill("clarity");
    await criterionRows.nth(1).getByLabel("Maximum score", { exact: true }).fill("101");
    await expect(page.getByText("Enter a whole number from 1 to 100.", { exact: true })).toBeVisible();
    await criterionRows.nth(1).getByLabel("Maximum score", { exact: true }).fill("5");
    await page.getByRole("button", { name: "Add criterion", exact: true }).click();
    await page.getByRole("button", { name: "Remove criterion 5", exact: true }).click();
    await expect(criterionRows).toHaveCount(4);
    await expect(page.getByRole("status").filter({ hasText: "Total: 35 points" })).toBeVisible();
    let publications = 0;
    page.on("request", (request) => { if (request.url().endsWith("/api/rubrics") && request.method() === "POST") publications++; });
    await page.getByRole("button", { name: "Review publication", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("All these criteria will be published together in one new version.");
    assert.equal(publications, 0);
    await page.getByRole("button", { name: "Keep editing", exact: true }).click();
    assert.equal((await fixture.db.select().from(rubricVersions)).length, 4);
    await page.setViewportSize({ width: 390, height: 390 });
    await page.getByRole("heading", { name: "Event & rubric", exact: true }).click();
    await page.screenshot({ path: "test-results/event-mobile.png", fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByRole("button", { name: "Review publication", exact: true }).click();
    await page.getByRole("button", { name: "Publish new rubric version", exact: true }).click();
    await expect(page.getByText("Rubric published as one new version.", { exact: true })).toBeVisible();
    assert.equal(publications, 1);
    const versions = await fixture.db.select().from(rubricVersions).orderBy(asc(rubricVersions.version));
    assert.equal(versions.length, 5); assert.deepEqual(versions.slice(0, 4), snapshots);
    const rubric = versions[4];
    assert.equal(rubric.version, 5); assert.deepEqual(rubric.criteria.map((c) => c.key), ["quality", "clarity", "usability", "originality"]);
    for (const viewport of [{ width: 390, height: 390 }, { width: 390, height: 844 }, { width: 1280, height: 390 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => scrollTo(0, 0));
      const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
      await expect(nav.getByRole("link")).toHaveCount(6);
      for (const link of await nav.getByRole("link").all()) {
        await link.scrollIntoViewIfNeeded();
        assert.ok(await link.evaluate((element) => { const rect = element.getBoundingClientRect(); const atPoint = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return element.contains(atPoint); }), "Navigation links must be reachable without overlap.");
      }
      await page.getByRole("button", { name: "Sign out", exact: true }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeInViewport();
      await expect(nav.getByRole("link", { name: "Event & rubric", exact: true })).toHaveAttribute("aria-current", "page");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    for (const name of ["Alpha", "Beta"]) {
      const [submission] = await fixture.db.insert(submissions).values({ eventId: event.id, name: `Review ${name}`, teamName: `Team ${name}`, repositoryUrl: `https://github.com/example/${name.toLowerCase()}`, repositoryOwner: "example", githubRepositoryId: name === "Alpha" ? "1" : "2", commitSha: SHA, claims: ["Test fixture claim"], ownershipAttested: true }).returning();
      if (name === "Alpha") {
        await page.goto(`${base}/analytics`);
        await expect(page.getByText("Your one eligible submission is available", { exact: false })).toBeVisible();
        await expect(page.getByText("No criterion scores yet.", { exact: false })).toBeVisible();
        await expect(page.getByText("No citation coverage records yet.", { exact: false })).toBeVisible();
        await expect(page.getByText("Submissions · select rows to filter", { exact: true })).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("canvas").first()).toBeVisible();
        await expect(page.locator(".ag-studio-layout-widget-loading-overlay-active")).toHaveCount(0);
        await page.screenshot({ path: "test-results/analytics-single-submission.png", fullPage: true });
        await page.setViewportSize({ width: 390, height: 390 });
        const embed = page.getByRole("region", { name: "AG Studio embedded analytics", exact: true });
        await embed.scrollIntoViewIfNeeded();
        await expect(embed).toBeVisible();
        await expect.poll(async () => page.locator(".ag-studio-layout-widget").evaluateAll((widgets) => {
          const bounds = widgets.map((widget) => widget.getBoundingClientRect()).sort((a, b) => a.y - b.y);
          return bounds.length === 3 && bounds.every((rect, i) => i === 0 || rect.y >= bounds[i - 1].bottom - 1);
        })).toBe(true);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: "test-results/analytics-single-mobile.png", fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1100 });
      }
      await queueEvaluation(fixture.db, organizer.id, { submissionId: submission.id, rubricVersionId: rubric.id }, AI_PIPELINE_VERSION);
      const job = await claimJob(fixture.db); assert.ok(job);
      const source = sourceFixture();
      const fetcher: typeof source = async (input, init) => /\/repos\/example\/(alpha|beta)$/.test(String(input)) ? Response.json({ id: Number(submission.githubRepositoryId), private: false, visibility: "public", full_name: `example/${name.toLowerCase()}`, owner: { login: "example" }, default_branch: "main" }) : source(input, init);
      assert.equal(await processJob(fixture.db, job, fetcher, name === "Alpha" ? { model: "mock", transport: async (request) => {
        const draft = modelDraft(request); draft.criteria[1] = { ...draft.criteria[1], suggestedScore: null, status: "NOT_EVALUATED", citations: [], findings: [] };
        return { text: JSON.stringify(draft), modelVersion: "browser-partial-fixture", finishReason: "STOP" };
      } } : modelOptions), true);
    }
    const reviews = await listReviews(fixture.db, organizer.id);
    const alpha = reviews.find((r) => r.submissionName === "Review Alpha")!;
    const beta = reviews.find((r) => r.submissionName === "Review Beta")!;
    await finalizeReview(fixture.db, organizer.id, beta.id, { criteria: beta.rubric.criteria.map((c) => ({ key: c.key, score: beta.scores[c.key], action: "accept" })), rationale: "Reviewed all Beta source citations and their limitations.", confirm: true });
    await page.goto(`${base}/judging`);
    await expect(page.locator(".ag-root")).toBeVisible();
    await page.screenshot({ path: "test-results/judging-desktop.png", fullPage: true });
    await expect(page.locator('.ag-row[row-id]')).toHaveCount(2);
    await page.getByLabel("Search projects, teams or SHA").fill("Alpha");
    await expect(page.locator('.ag-row[row-id]')).toHaveCount(1);
    await page.getByLabel("Search projects, teams or SHA").fill("");
    await page.locator('.ag-header-cell[col-id="project"] .ag-header-cell-text').click();
    await expect(page.getByRole("columnheader", { name: "Project · open review", exact: true })).toHaveAttribute("aria-sort", "ascending");
    await page.getByLabel("AI suggestions", { exact: true }).uncheck();
    await expect(page.locator('.ag-header-cell[col-id="aiTotal"]')).toHaveCount(0);
    await page.getByLabel("AI suggestions", { exact: true }).check();
    await page.getByText("Accessible assessment links", { exact: false }).click();
    await page.getByRole("link", { name: /Review Alpha · Browser rubric/ }).click();
    await expect(page.getByRole("heading", { name: "Your human decision" })).toBeVisible();
    await expect(page.getByLabel("Clarity final score", { exact: true })).toHaveValue("");
    await page.getByLabel("Clarity final score", { exact: true }).fill("2");
    await page.getByLabel("Clarity override reasoning", { exact: true }).fill("I reviewed the documentation gap and assigned a limited score explicitly.");
    await page.getByLabel("Overall review rationale", { exact: false }).fill("I reviewed the pinned source citations and accounted for static evidence limitations.");
    await page.getByRole("button", { name: "Review final decision", exact: true }).click();
    await expect(page.getByText("Confirm your final assessment", { exact: true })).toBeVisible();
    await page.screenshot({ path: "test-results/review-confirmation.png", fullPage: true });
    assert.equal((await fixture.db.select().from(assessments).where(eq(assessments.sourceDraftId, alpha.id))).length, 0);
    await page.getByRole("button", { name: "Finalize human assessment", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Human-finalized assessment/ })).toBeVisible();
    await expect(page.getByText("Original AI draft · suggested scores", { exact: true })).toBeVisible();
    assert.equal((await fixture.db.select().from(assessments).where(eq(assessments.sourceDraftId, alpha.id))).length, 1);
    await page.goto(`${base}/analytics`);
    await expect(page.getByLabel("AG Studio embedded analytics", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Submissions · select rows to filter", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("canvas").first()).toBeVisible();
    const studioRows = page.locator(".ag-studio-layout-widget .ag-row[row-id]");
    await expect(studioRows).toHaveCount(2);
    await studioRows.filter({ hasText: "Review Alpha" }).click();
    await expect(studioRows.filter({ hasText: "Review Alpha" })).toHaveAttribute("aria-selected", "true");
    await studioRows.filter({ hasText: "Review Alpha" }).click();
    await expect(studioRows.filter({ hasText: "Review Alpha" })).toHaveAttribute("aria-selected", "false");
    await expect(page.locator(".ag-studio-layout-widget-loading-overlay-active")).toHaveCount(0);
    await page.screenshot({ path: "test-results/analytics-desktop.png", fullPage: true });
    await page.getByText("Criterion comparisons", { exact: true }).click();
    await expect(page.getByText("Mean criterion score (%)", { exact: true })).toBeVisible();
    await page.getByText("Score distributions", { exact: true }).click();
    await expect(page.getByText("Human-finalized scores (%)", { exact: true })).toBeVisible();
    await page.getByText("Evidence coverage", { exact: true }).click();
    await expect(page.getByText("Collected evidence and omissions", { exact: true })).toBeVisible();
    await page.getByLabel("Studio mode", { exact: false }).selectOption("edit");
    await expect(page.getByText("Collected evidence and omissions", { exact: true })).toBeVisible();
    await expect(page.locator(".ag-studio-layout-widget .ag-row[row-id]").filter({ hasText: /Review (Alpha|Beta)/ })).toHaveCount(2);
    await expect(page.locator(".ag-studio-layout-widget-loading-overlay-active")).toHaveCount(0);
    await page.screenshot({ path: "test-results/analytics-editor.png", fullPage: true });
    await expect(page.getByText("AG Studio could not render part of this report.", { exact: false })).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/judging`);
    await expect(page.locator(".ag-root")).toBeVisible();
    await page.screenshot({ path: "test-results/judging-mobile.png", fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Grid must stay within mobile page width.");
    assert.deepEqual(runtimeErrors, []);
  } finally {
    await browser?.close();
    if (proxy) { proxy.closeAllConnections(); await new Promise<void>((resolve) => proxy!.close(() => resolve())); }
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGTERM");
      const timer = setTimeout(() => child?.kill("SIGKILL"), 5000); timer.unref(); await exited; clearTimeout(timer);
    }
    await fixture.close();
    await rm(certificates, { recursive: true, force: true });
  }
});
