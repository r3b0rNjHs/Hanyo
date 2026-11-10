import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("input[type=password]", "hanyo");
  await page.click('button:has-text("Entrar")');
  await page.waitForURL("/");
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
  await page.getByRole("link", { name: /Demo Strip/ }).first().click();
  await page.waitForURL(/\/series\/\d+/);
  await page.getByRole("link", { name: /Leer|Empezar|Seguir/ }).first().click();
  await page.waitForURL(/\/read\/\d+/);
  await expect(page.locator('img[alt="Página 1"]')).toBeVisible();

  const next = page.getByRole("button", { name: /Seguir leyendo/ });
  for (let i = 0; i < 20 && !(await next.isVisible()); i++) {
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(250);
  }
  await expect(next).toBeVisible();
  await expect(page.getByText("Capítulo 1 terminado")).toBeVisible();
  await next.click();
  await expect(page.getByText(/Cap\. 2/)).toBeVisible();
});

test("download a chapter and read it offline", async ({ page, context }) => {
  await login(page);
  await page.goto("/");
  await page.getByRole("link", { name: /Demo Strip/ }).first().click();
  await page.waitForURL(/\/series\/\d+/);
  // The service worker must control the page for offline reading.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 });

  await page.getByRole("button", { name: "Descargar Capítulo 3" }).click();
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
