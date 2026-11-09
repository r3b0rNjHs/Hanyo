#!/usr/bin/env bash
# Install/update the Mihon extensions listed in extensions.txt into Suwayomi.
# Idempotent: safe to run on every deploy.
set -euo pipefail
cd "$(dirname "$0")"
SUWAYOMI_URL="${SUWAYOMI_URL:-http://127.0.0.1:4567}"

gql() {
  curl -sf -X POST "$SUWAYOMI_URL/api/graphql" -H 'Content-Type: application/json' -d "$1"
}

echo "Waiting for Suwayomi at $SUWAYOMI_URL..."
for _ in $(seq 1 60); do
  gql '{"query":"{ aboutServer { version } }"}' >/dev/null 2>&1 && break
  sleep 3
done

echo "Refreshing extension list..."
gql '{"query":"mutation { fetchExtensions(input:{}) { extensions { pkgName } } }"}' >/dev/null

ids=$(grep -vE '^\s*(#|$)' extensions.txt | sed 's/.*/"&"/' | paste -sd, -)
echo "Installing: $ids"
query=$(printf '{"query":"mutation { updateExtensions(input:{ids:[%s], patch:{install:true}}) { extensions { name versionName isInstalled } } }"}' "${ids//\"/\\\"}")
gql "$query" | grep -oE '"name":"[^"]+","versionName":"[^"]+","isInstalled":(true|false)' || true

# Update anything with a newer version available.
gql '{"query":"mutation { updateExtensions(input:{ids:[], patch:{update:true}}) { extensions { name } } }"}' >/dev/null 2>&1 || true

echo "Installed English sources:"
gql '{"query":"{ sources(filter:{lang:{equalTo:\"en\"}}) { nodes { id name } } }"}' | grep -oE '"id":"[0-9]+","name":"[^"]+"' || true
