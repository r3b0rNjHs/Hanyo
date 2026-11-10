#!/usr/bin/env python3
"""Check which Suwayomi sources actually work from this server.

For every extension listed in candidate-sources.txt (or the files given as arguments) it installs
the extension, then per source: searches a few well-known series, opens the first hit, lists its
chapters, resolves one chapter's pages and downloads the first page image. Many sites block
datacenter IPs (Weeb Central does, through Cloudflare), so only the image download proves a
source is usable here.

Run on the VPS:  python3 deploy/test-sources.py            (Suwayomi on 127.0.0.1:4567)
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

SUWAYOMI = os.environ.get("SUWAYOMI_URL", "http://127.0.0.1:4567")
QUERIES = ["Eleceed", "Lookism", "Solo Leveling"]
HERE = os.path.dirname(os.path.abspath(__file__))


def gql(query, variables=None, timeout=90):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(f"{SUWAYOMI}/api/graphql", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    if data.get("errors"):
        raise RuntimeError(data["errors"][0]["message"].split("\n")[0][:120])
    return data["data"]


def image_ok(path):
    try:
        with urllib.request.urlopen(f"{SUWAYOMI}{path}", timeout=90) as r:
            ctype = r.headers.get("Content-Type", "")
            size = len(r.read())
            return ctype.startswith("image/") and size > 1000, f"{ctype} {size // 1024} KB"
    except urllib.error.HTTPError as e:
        return False, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 - report anything as a failure
        return False, type(e).__name__


def packages(files):
    pkgs = []
    for f in files:
        with open(f) as fh:
            pkgs += [l.strip() for l in fh if l.strip() and not l.startswith("#")]
    return list(dict.fromkeys(pkgs))


def test_source(src):
    row = {"source": f'{src["name"]} ({src["lang"]})', "search": "-", "chapters": "-", "pages": "-", "image": "-", "ok": False}
    hit = None
    for q in QUERIES:
        try:
            mangas = gql(
                "mutation($s: LongString!, $q: String) { fetchSourceManga(input: {source: $s, type: SEARCH, page: 1, query: $q}) { mangas { id title } } }",
                {"s": src["id"], "q": q},
            )["fetchSourceManga"]["mangas"]
        except Exception as e:  # noqa: BLE001
            row["search"] = f"error: {e}"[:40]
            return row
        match = next((m for m in mangas if q.lower() in m["title"].lower()), None)
        if match and not hit:
            hit = match
        row["search"] = f"{len(mangas)} results" if not match else f"found «{match['title'][:18]}»"
        if hit:
            break
    if not hit:
        return row
    try:
        chapters = gql(
            "mutation($id: Int!) { fetchMangaAndChapters(input: {id: $id, fetchManga: true, fetchChapters: true}) { chapters { id name } } }",
            {"id": hit["id"]},
        )["fetchMangaAndChapters"]["chapters"]
        row["chapters"] = str(len(chapters))
        if not chapters:
            return row
        pages = gql(
            "mutation($id: Int!) { fetchChapterPages(input: {chapterId: $id}) { pages } }",
            {"id": chapters[len(chapters) // 2]["id"]},
        )["fetchChapterPages"]["pages"]
        row["pages"] = str(len(pages))
        if pages:
            ok, detail = image_ok(pages[0])
            row["image"] = ("OK " if ok else "FAIL ") + detail
            row["ok"] = ok
    except Exception as e:  # noqa: BLE001
        row["image"] = f"error: {e}"[:40]
    return row


def main():
    files = sys.argv[1:] or [os.path.join(HERE, "candidate-sources.txt")]
    pkgs = packages(files)
    print(f"Installing {len(pkgs)} extensions…", flush=True)
    gql("mutation { fetchExtensions(input: {}) { extensions { pkgName } } }")
    gql(
        "mutation($ids: [String!]!) { updateExtensions(input: {ids: $ids, patch: {install: true}}) { extensions { pkgName } } }",
        {"ids": pkgs},
        timeout=600,
    )
    exts = gql("{ extensions { nodes { pkgName name isInstalled source { nodes { id name lang } } } } }")["extensions"]["nodes"]
    sources = [
        s
        for e in exts
        if e["pkgName"] in pkgs and e["isInstalled"]
        for s in e["source"]["nodes"]
        if s["lang"] in ("en", "es", "es-419", "all")
    ]
    missing = [p for p in pkgs if not any(e["pkgName"] == p and e["isInstalled"] for e in exts)]
    if missing:
        print("Not installed (not in the repo?):", ", ".join(m.split(".")[-1] for m in missing))
    print(f"Testing {len(sources)} sources (searching {', '.join(QUERIES)})…\n", flush=True)

    rows = []
    for s in sources:
        t0 = time.time()
        row = test_source(s)
        row["secs"] = f"{time.time() - t0:.0f}s"
        rows.append(row)
        mark = "✅" if row["ok"] else "❌"
        print(f"{mark} {row['source'][:28]:28} | {row['search'][:30]:30} | caps {row['chapters']:>5} | págs {row['pages']:>4} | {row['image'][:28]:28} | {row['secs']}", flush=True)

    out = os.path.join(HERE, "..", "logs", "source-test.tsv")
    try:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as fh:
            fh.write("ok\tsource\tsearch\tchapters\tpages\timage\n")
            for r in rows:
                fh.write(f"{'yes' if r['ok'] else 'no'}\t{r['source']}\t{r['search']}\t{r['chapters']}\t{r['pages']}\t{r['image']}\n")
    except OSError:
        pass
    good = [r["source"] for r in rows if r["ok"]]
    print(f"\n{len(good)}/{len(rows)} sources work from this server: {', '.join(good) or 'none'}")


if __name__ == "__main__":
    main()
