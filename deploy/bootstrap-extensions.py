#!/usr/bin/env python3
"""Make Suwayomi's installed extensions match deploy/extensions.txt exactly.

Installs missing ones, updates outdated ones and uninstalls anything not listed (for example
the candidates installed by test-sources.py), so search only queries the chosen sources.
Idempotent; safe to run on every deploy.
"""
import json
import os
import sys
import time
import urllib.request

SUWAYOMI = os.environ.get("SUWAYOMI_URL", "http://127.0.0.1:4567")
HERE = os.path.dirname(os.path.abspath(__file__))


def gql(query, variables=None, timeout=120):
    body = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(f"{SUWAYOMI}/api/graphql", body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)
    if data.get("errors"):
        raise RuntimeError(data["errors"][0]["message"].split("\n")[0][:160])
    return data["data"]


def wanted():
    with open(os.path.join(HERE, "extensions.txt")) as fh:
        return [l.strip() for l in fh if l.strip() and not l.lstrip().startswith("#")]


def patch(ids, **flags):
    if ids:
        gql(
            "mutation($ids: [String!]!, $p: UpdateExtensionPatchInput!) { updateExtensions(input: {ids: $ids, patch: $p}) { extensions { pkgName } } }",
            {"ids": ids, "p": flags},
            timeout=600,
        )


def main():
    print(f"Waiting for Suwayomi at {SUWAYOMI}…", flush=True)
    for _ in range(60):
        try:
            gql("{ aboutServer { version } }", timeout=10)
            break
        except Exception:  # noqa: BLE001 - still starting
            time.sleep(3)
    else:
        sys.exit("Suwayomi is not reachable")

    exts = gql("mutation { fetchExtensions(input: {}) { extensions { pkgName name isInstalled hasUpdate } } }")[
        "fetchExtensions"
    ]["extensions"]
    keep = wanted()
    known = {e["pkgName"] for e in exts}
    unknown = [p for p in keep if p not in known]
    to_install = [e["pkgName"] for e in exts if e["pkgName"] in keep and not e["isInstalled"]]
    to_update = [e["pkgName"] for e in exts if e["pkgName"] in keep and e["isInstalled"] and e["hasUpdate"]]
    to_remove = [e["pkgName"] for e in exts if e["isInstalled"] and e["pkgName"] not in keep]

    patch(to_install, install=True)
    patch(to_update, update=True)
    patch(to_remove, uninstall=True)
    short = lambda ps: ", ".join(p.split(".")[-1] for p in ps) or "-"  # noqa: E731
    print(f"installed: {short(to_install)}\nupdated: {short(to_update)}\nuninstalled: {short(to_remove)}")
    if unknown:
        print(f"not in the repo: {short(unknown)}")

    sources = gql("{ sources { nodes { id name lang } } }")["sources"]["nodes"]
    active = sorted(f"{s['name']} ({s['lang']})" for s in sources if s["id"] != "0")
    print(f"{len(active)} sources active: " + ", ".join(active))


if __name__ == "__main__":
    main()
