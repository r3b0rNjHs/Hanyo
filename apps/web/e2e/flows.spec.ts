import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("input[type=password]", "hanyo");
  await page.click('button:has-text("Entrar")');
  await page.waitForURL("/");
}

/** Open a series from the library grid (the "Leyendo" carousel jumps straight into the reader). */
async function openSeries(page: Page, title: string) {
  await page.locator('a[href^="/series/"]:not([href*="resume"])', { hasText: title }).first().click();
  await page.waitForURL(/\/series\/\d+$/);
}

test.describe.configure({ mode: "serial" });

test("search, open and add a series to a reading list", async ({ page }) => {
  await login(page);
  await expect(page.getByText("Empieza tu biblioteca")).toBeVisible();

  await page.goto("/search?q=Demo%20Strip");
  await page.getByRole("button", { name: /Demo Strip/ }).first().click();
  await page.waitForURL(/\/series\/\d+/);
  await expect(page.getByRole("heading", { name: "Demo Strip" })).toBeVisible();

  // Never read → goes to "Pendiente"; the button then opens the list picker.
  await page.getByRole("button", { name: "Añadir a la biblioteca" }).click();
  await expect(page.getByRole("button", { name: "Lista: Pendiente" })).toBeVisible();
  await page.getByRole("button", { name: "Lista: Pendiente" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Leyendo" }).click();
  await expect(page.getByRole("button", { name: "Lista: Leyendo" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("tab", { name: /Leyendo/ }).click();
  await expect(page.getByRole("link", { name: /Demo Strip/ }).first()).toBeVisible();
});

test("read a chapter to the end and continue to the next one", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await openSeries(page, "Demo Strip");
  await page.waitForURL(/\/series\/\d+/);
  await page.getByRole("link", { name: /Leer|Empezar|Seguir/ }).first().click();
  await page.waitForURL(/\/read\/\d+/);
  await expect(page.locator('img[alt="Página 1"]')).toBeVisible();

  // Scroll to the end like a reader would; reaching it saves the chapter as read.
  const saved = page.waitForRequest((r) => r.url().endsWith("/api/progress") && r.postDataJSON()?.completed === true);
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(150);
  }
  await saved;
  const next = page.getByRole("button", { name: /Seguir leyendo/ });
  await expect(next).toBeInViewport();
  await expect(page.getByText("Capítulo 1 terminado")).toBeVisible();
  await next.click();
  await expect(page.getByText(/Cap\. 2/)).toBeVisible();
});

test("download a chapter and read it offline", async ({ page, context }) => {
  await login(page);
  await page.goto("/");
  await openSeries(page, "Demo Strip");
  await page.waitForURL(/\/series\/\d+/);
  // The service worker must control the page for offline reading.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 });

  await page.locator('section[aria-label="Todos los capítulos"]').getByRole("button", { name: "Descargar Capítulo 3" }).click();
  await expect(page.getByRole("button", { name: "Gestionar descargas" })).toContainText("1 de 3 descargados", {
    timeout: 30_000,
  });
  const chapterUrl = await page
    .locator('section[aria-label="Todos los capítulos"] li', { hasText: "Capítulo 3" })
    .getByRole("link")
    .getAttribute("href");

  await context.setOffline(true);
  await page.goto(chapterUrl!);
  await expect(page.locator('img[alt="Página 1"]')).toBeVisible();
  const loaded = await page
    .locator('img[alt="Página 1"]')
    .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
  await context.setOffline(false);
});

test("explore lists the source's series", async ({ page }) => {
  await login(page);
  await page.goto("/explore");
  await page.getByRole("tab", { name: "Demo" }).click();
  await expect(page.getByRole("button", { name: /Demo Paged/ })).toBeVisible();
  // Demo Strip was added in the first test: marked, and it opens the library series directly.
  const owned = page.getByRole("button", { name: /Demo Strip/ });
  await expect(owned.getByLabel("En tu biblioteca")).toBeVisible();
  await owned.click();
  await page.waitForURL(/\/series\/\d+/);
  await expect(page.getByRole("button", { name: /Lista:/ })).toBeVisible();
});

test("jump to another chapter from the reader's chapter list", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await openSeries(page, "Demo Strip");
  await page.waitForURL(/\/series\/\d+/);
  const first = page.locator('section[aria-label="Todos los capítulos"] li', { hasText: "Capítulo 1" }).getByRole("link");
  await first.click();
  await page.waitForURL(/\/read\/\d+/);
  await page.getByRole("button", { name: "Capítulos" }).click();
  await page.getByRole("dialog", { name: "Capítulos" }).getByRole("button", { name: /Capítulo 3/ }).click();
  await expect(page.getByText(/Cap\. 3/)).toBeVisible();
});

test("free space by deleting downloaded chapters already read", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await openSeries(page, "Demo Strip");
  await page.waitForURL(/\/series\/\d+/);
  // Chapter 1 was read to the end in an earlier test.
  await page.getByRole("button", { name: "Descargar Capítulo 1" }).click();
  await expect(page.getByRole("button", { name: "Gestionar descargas" })).toContainText("descargados", { timeout: 30_000 });
  await page.goto("/downloads");
  await expect(page.getByText("1 capítulo ya leído")).toBeVisible();
  await page.getByRole("button", { name: "Borrar" }).click();
  await expect(page.getByText("1 capítulo ya leído")).toBeHidden();
});

test("paged mode: tap through a chapter and finish it", async ({ page }) => {
  await login(page);
  await page.goto("/search?q=Demo%20Paged");
  await page.getByRole("button", { name: /Demo Paged/ }).first().click();
  await page.waitForURL(/\/series\/\d+/);
  await page.getByRole("link", { name: /Leer|Empezar/ }).first().click();
  await page.waitForURL(/\/read\/\d+/);
  // Not tagged as a long strip and pages are page-shaped → paged mode.
  await expect(page.locator('img[alt="Página 1"]')).toBeVisible();
  const saved = page.waitForRequest((r) => r.url().endsWith("/api/progress") && r.postDataJSON()?.completed === true);
  const { width, height } = page.viewportSize()!;
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(width - 20, height / 2); // right third = next (LTR) / previous (RTL)
    await page.waitForTimeout(150);
  }
  // Auto mode may pick RTL for manga; then the left third goes forward.
  if (!(await page.getByRole("button", { name: /Seguir leyendo/ }).isVisible())) {
    for (let i = 0; i < 10; i++) {
      await page.mouse.click(20, height / 2);
      await page.waitForTimeout(150);
    }
  }
  await saved;
  await expect(page.getByRole("button", { name: /Seguir leyendo/ })).toBeInViewport();
});

test("Novedades lists the latest chapters of the series you read", async ({ page }) => {
  await login(page);
  await page.goto("/updates");
  const row = page.getByRole("link", { name: /Demo Strip.*Capítulo 3/ });
  await expect(row).toBeVisible();
  await row.click();
  await page.waitForURL(/\/read\/\d+/);
  await expect(page.getByText(/Cap\. 3/)).toBeVisible();
});

test("search is reached from Explore and can be cancelled", async ({ page }) => {
  await login(page);
  await page.goto("/explore");
  await page.getByRole("link", { name: /Buscar en todas las fuentes/ }).click();
  await page.waitForURL(/\/search/);
  await expect(page.getByRole("link", { name: "Explorar" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Cancelar" }).click();
  await page.waitForURL(/\/explore/);
});

test("chapter row actions: mark a chapter read without opening it", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await openSeries(page, "Demo Strip");
  const row = page.locator('section[aria-label="Todos los capítulos"] li', { hasText: "Capítulo 2" });
  await row.getByRole("link").click({ button: "right" });
  await row.getByRole("button", { name: "Leído", exact: true }).click();
  // Actions close again (hidden from the accessibility tree) and the label flips.
  await expect(row.getByText("No leído")).toBeAttached();
  await expect(row.locator("p").first()).toHaveClass(/text-faint/);
});

test("history shows where you left each series and can forget one", async ({ page }) => {
  await login(page);
  await page.goto("/updates");
  await page.getByRole("tab", { name: "Historial" }).click();
  await page.waitForURL(/view=history/);
  const row = page.locator("li", { hasText: "Demo Strip" });
  await expect(row.getByRole("link", { name: "Seguir leyendo Demo Strip" })).toBeVisible();
  await row.getByRole("link", { name: /^Demo Strip/ }).click({ button: "right" });
  await row.getByText("Quitar").click();
  await expect(page.locator("li", { hasText: "Demo Strip" })).toHaveCount(0);
});

test("turn off new-chapter notifications for one series", async ({ page }) => {
  await login(page);
  await page.goto("/");
  await openSeries(page, "Demo Strip");
  const bell = page.getByRole("button", { name: /Avisos de capítulos nuevos/ });
  await expect(bell).toHaveAttribute("aria-pressed", "true");
  await bell.click();
  await expect(page.getByText("Sin avisos para esta serie")).toBeVisible();
  await expect(bell).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.getByRole("button", { name: /Avisos de capítulos nuevos/ })).toHaveAttribute("aria-pressed", "false");
});

test("settings can check that the sources work", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  await expect(page.getByText("Sin comprobar")).toBeVisible();
  await page.getByRole("button", { name: "Comprobar" }).click();
  await expect(page.getByText("Todas funcionan (1)")).toBeVisible({ timeout: 20_000 });
});

test("the next chapter is prefetched and opens with no connection", async ({ page, context }) => {
  await login(page);
  await page.goto("/search?q=Demo%20Paged");
  await page.getByRole("button", { name: /Demo Paged/ }).first().click();
  await page.waitForURL(/\/series\/\d+/);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 });
  await page.locator('section[aria-label="Todos los capítulos"] li', { hasText: "Capítulo 1" }).getByRole("link").click();
  await page.waitForURL(/\/read\/\d+/);
  const { width, height } = page.viewportSize()!;
  // Turn pages until the end card says the next chapter is ready (either reading direction).
  const ready = page.getByText("Listo para leer");
  for (let i = 0; i < 12 && !(await ready.isVisible()); i++) {
    await page.mouse.click(i < 6 ? width - 20 : 20, height / 2);
    await page.waitForTimeout(300);
  }
  await expect(ready).toBeVisible({ timeout: 20_000 });

  await context.setOffline(true);
  await page.getByRole("button", { name: /Seguir leyendo/ }).click();
  await expect(page.getByText(/Cap\. 2/)).toBeVisible();
  const loaded = await page
    .locator('img[alt="Página 1"]')
    .evaluate((img: HTMLImageElement) => new Promise((r) => (img.complete ? r(img.naturalWidth > 0) : (img.onload = () => r(true)))));
  expect(loaded).toBe(true);
  await context.setOffline(false);
});

test("reading stats count the chapters read in the earlier tests", async ({ page }) => {
  await login(page);
  await page.goto("/updates?view=history");
  await page.getByRole("link", { name: /Tus estadísticas/ }).click();
  await page.waitForURL(/\/stats/);
  const label = page.getByText("Esta semana · capítulos", { exact: true });
  await expect(label).toBeVisible();
  const value = await label.locator("xpath=preceding-sibling::p[1]").innerText();
  expect(Number(value.trim())).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("gridcell").last()).toBeVisible();
});
