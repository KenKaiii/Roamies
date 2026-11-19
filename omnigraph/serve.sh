#!/bin/bash
# Serves the Clanky memory graph on localhost. Data and tokens live outside the repo, in ~/Roamies/Data.
# First-time setup and schema changes: see omnigraph/README.md.
set -euo pipefail
DATA="$HOME/Roamies/Data/omnigraph"
TOKENS="$HOME/Roamies/Data/omnigraph.tokens.json"
# omnigraph-server 0.15.0 overflows the default 2 MB worker stack on its first MCP mutate.
export RUST_MIN_STACK=16777216
export OMNIGRAPH_SERVER_BEARER_TOKENS_JSON="$(cat "$TOKENS")"
exec omnigraph-server --cluster "file://$DATA" --bind 127.0.0.1:7811
