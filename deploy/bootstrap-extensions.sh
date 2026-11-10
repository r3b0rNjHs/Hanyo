#!/usr/bin/env bash
# Kept for setup.sh / deploy.sh: the logic lives in bootstrap-extensions.py.
exec python3 "$(dirname "$0")/bootstrap-extensions.py" "$@"
