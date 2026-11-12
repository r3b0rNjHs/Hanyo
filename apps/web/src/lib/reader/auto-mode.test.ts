import { describe, expect, it } from "vitest";
import { autoModeFor } from "./settings.svelte";

describe("autoModeFor", () => {
  it("reads strips cut into short slices as vertical", () => {
    expect(autoModeFor([], [2.0, 2.0, 2.0])).toBe("vertical"); // Kun Manga Online
    expect(autoModeFor([], [1.8, 1.8, 1.8])).toBe("vertical");
    expect(autoModeFor([], [10.4, 9.8, 10.1])).toBe("vertical");
  });
  it("keeps manga pages paged", () => {
    expect(autoModeFor([], [1.41, 1.42, 1.44])).toBe("rtl");
    expect(autoModeFor([], [1.54, 1.5, 0.7])).toBe("rtl");
  });
  it("trusts long-strip tags and defaults to vertical", () => {
    expect(autoModeFor(["Long Strip"], [1.4, 1.4, 1.4])).toBe("vertical");
    expect(autoModeFor([], [])).toBe("vertical");
  });
});
