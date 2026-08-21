# AC-018 root integration

Do not edit this in the same change as another lane's root file.

`packages/harness` already exists (AC-017). Replay is added inside that package. `workspaces` already includes `packages/*`.

Root `scripts.typecheck`, `scripts.test`, and `scripts.lint:effect` already run `packages/harness`. No chain edit is needed.

## `scripts.harness`

Add this root script so `bun harness replay <fixture> --against <impl>` works from the repo root:

```json
"harness": "bun run --cwd packages/harness harness"
```

Example:

```text
bun harness replay packages/harness/fixtures/claude-session-reference.ndjson --against "$ACEPE_SIDECAR_BIN"
```

`--against` is the candidate implementation binary. Extra args after `--` are passed to that binary. `ACEPE_SIDECAR_BIN` is used when `--against` is omitted.
