import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseWeebCentralImages } from "../src/providers/direct.js";

describe("Weeb Central direct pages", () => {
  // Real response of /chapters/{id}/images for Questism chapter 32 (captured 2026-11-10).
  const html = fs.readFileSync(path.join(import.meta.dirname, "fixtures/weebcentral-chapter-images.html"), "utf8");

  it("extracts every page image in reading order", () => {
    const urls = parseWeebCentralImages(html);
    expect(urls).toHaveLength(189);
    expect(urls[0]).toBe("https://official.lowee.us/manga/QUESTISM/0032-001.png");
    expect(urls[188]).toBe("https://official.lowee.us/manga/QUESTISM/0032-189.png");
  });

  it("ignores images that aren't pages and sorts by page number", () => {
    const urls = parseWeebCentralImages(
      '<img src="/static/logo.png" alt="logo"><img src="https://x/2.png" alt="Page 2"><img\n src="https://x/1.png"\n alt="Page 1" />',
    );
    expect(urls).toEqual(["https://x/1.png", "https://x/2.png"]);
  });
});
