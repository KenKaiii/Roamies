# Clanky memory graph (Omnigraph)

Graph memory from step 5 of [docs/CLANKY_PLAN.md](../docs/CLANKY_PLAN.md). Source lives here; data and tokens
live in `~/Clanky/Data/` and are never committed.

| File | What it is |
|---|---|
| `schema.pg` | Node and edge types. Preferences are `Lesson` nodes with `kind: preference`. |
| `queries/*.gq` | Stored queries, e.g. `lessons_for_app` (top 5 by BM25). |
| `graph.policy.yaml` | `act-agent` writes only to unprotected branches (`proposed`); only `act-me` merges into `main`. |
| `serve.sh` | Starts the server on `127.0.0.1:7811`. |

## Run

```sh
./omnigraph/serve.sh
```

Claude Code connects as `act-agent` (`claude mcp add --scope user --transport http clanky-memory
http://127.0.0.1:7811/mcp --header "Authorization: Bearer <act-agent token>"`).

## First-time setup

```sh
brew install ModernRelay/tap/omnigraph
D=~/Clanky/Data/omnigraph; mkdir -p $D
cd omnigraph
omnigraph cluster apply --target $D --config . --as act-me
omnigraph cluster force-unlock <lock_id printed by apply> --target $D
umask 077; python3 -c "import secrets,json;print(json.dumps({'act-me':secrets.token_urlsafe(32),'act-agent':secrets.token_urlsafe(32)}))" > ~/Clanky/Data/omnigraph.tokens.json
```

## Changing the schema or queries

Stop the server, then: `omnigraph lint --schema schema.pg --query queries/<file>.gq`, `cluster plan`, `cluster apply`
(same `--target` and `--config` as above), `force-unlock`, and start the server again. If the server crashed, it
keeps its lock: read the ID with `omnigraph cluster status --target $D --json` and force-unlock it.

## Known limits

- `omnigraph-server` has no TLS, and the CLI sends tokens only over HTTPS, so CLI targets don't work yet.
  Owner actions (merging `proposed`) go through the MCP or HTTP API with the `act-me` token for now.
- The server runs only while you start it. A LaunchAgent can come later.
