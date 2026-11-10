import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { compressPage, JobQueue, WEBP_MAX_DIMENSION } from "../src/services/compress.js";

/** Noisy image so encoders can't shrink it to nothing (closer to real artwork than a flat colour). */
async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 251;
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
}

describe("compressPage", () => {
  it("re-encodes normal pages to a smaller WebP", async () => {
    const input = await noisyJpeg(400, 600);
    const out = await compressPage(input, 90);
    expect(out.format).toBe("webp");
    expect(out.bytes.length).toBeLessThan(input.length);
    expect((await sharp(out.bytes).metadata()).format).toBe("webp");
  });

  it("falls back to mozjpeg for strips taller than WebP allows", async () => {
    const input = await noisyJpeg(64, WEBP_MAX_DIMENSION + 100);
    const out = await compressPage(input, 90);
    expect(out.format).toBe("jpeg");
    const meta = await sharp(out.bytes).metadata();
    expect(meta.height).toBe(WEBP_MAX_DIMENSION + 100);
  });

  it("keeps the original when re-encoding would not make it smaller", async () => {
    const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).webp({ quality: 10 }).toBuffer();
    const out = await compressPage(tiny, 90);
    expect(out.format).toBe("original");
    expect(out.bytes).toBe(tiny);
  });

  it("keeps the original for data it cannot decode", async () => {
    const junk = Buffer.from("not an image");
    expect((await compressPage(junk, 90)).format).toBe("original");
  });
});

describe("JobQueue", () => {
  it("bounds concurrency and de-duplicates jobs by key", async () => {
    const q = new JobQueue(2);
    let running = 0;
    let peak = 0;
    let calls = 0;
    const job = async () => {
      calls++;
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
    };
    await Promise.all([q.run("a", job), q.run("a", job), q.run("b", job), q.run("c", job), q.run("d", job)]);
    expect(calls).toBe(4);
    expect(peak).toBe(2);
  });
});
