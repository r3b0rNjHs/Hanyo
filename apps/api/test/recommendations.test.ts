import { describe, expect, it } from "vitest";
import { openMemoryDb } from "../src/db/index.js";
import { RecommendationService } from "../src/services/recommendations.js";
import { UserService } from "../src/services/users.js";

function setup() {
  const db = openMemoryDb();
  const users = new UserService(db);
  users.bootstrap("admin-password");
  const marta = users.create("marta", "marta-password");
  const pablo = users.create("pablo", "pablo-password");
  db.prepare(
    "INSERT INTO series (id, title, cover_url, description, authors, genres, status, updated_at) VALUES (7, 'Eleceed', NULL, NULL, '[]', '[]', 'ongoing', 0)",
  ).run();
  return { db, recs: new RecommendationService(db), marta, pablo };
}

describe("RecommendationService", () => {
  it("lists the other accounts only", () => {
    const { recs, marta } = setup();
    expect(recs.directory(1).map((u) => u.username)).toEqual(["marta", "pablo"]);
    expect(recs.directory(marta.id).map((u) => u.username)).toEqual(["admin", "pablo"]);
  });

  it("delivers to the chosen recipients only, without duplicates", () => {
    const { recs, marta, pablo } = setup();
    expect(recs.send(1, [marta.id, marta.id, 999, 1], 7, "  muy buena  ")).toEqual([marta.id]);
    expect(recs.incoming(marta.id)).toMatchObject([{ from: "admin", seriesTitle: "Eleceed", note: "muy buena", seen: false }]);
    expect(recs.incoming(pablo.id)).toEqual([]);
    // Sending again refreshes it instead of adding a second one.
    recs.send(1, [marta.id], 7, null);
    expect(recs.incoming(marta.id)).toHaveLength(1);
  });

  it("can be seen, dismissed, or cleared by adding the series", () => {
    const { recs, marta, pablo } = setup();
    recs.send(1, [marta.id, pablo.id], 7, null);
    recs.markSeen(marta.id);
    expect(recs.incoming(marta.id)[0]!.seen).toBe(true);
    // Only the recipient can dismiss it.
    recs.dismiss(pablo.id, recs.incoming(marta.id)[0]!.id);
    expect(recs.incoming(marta.id)).toHaveLength(1);
    recs.dismiss(marta.id, recs.incoming(marta.id)[0]!.id);
    expect(recs.incoming(marta.id)).toEqual([]);
    recs.dismissForSeries(pablo.id, 7);
    expect(recs.incoming(pablo.id)).toEqual([]);
  });
});
