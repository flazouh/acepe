# ADR-0010: Package provider code by provider, with one file vocabulary

## Status

Accepted — 2026-08-26

## Context

`packages/server/src/provider/Layers/` held 21 flat files. Five providers lived side by side there, each contributing a triple: a provider descriptor, a translation module, and an adapter. Three of those files passed 1000 lines.

The layout produced three costs.

Names drifted. One role carried five names: `ClaudeSdkMap`, `CodexNativeMap`, `CopilotAcpMap`, `CursorAcpMap`, `OpenCodeMap`. A reader could not guess a filename, so every navigation started with a search.

Roles mixed inside one file. Each translation module holds the same five concerns in sequence: the fact vocabulary, the stream state, the recognisers, the encode and decode pair, and the ACP projection. A change to the storage row shape and a change to a stream dedup rule touched the same file for unrelated reasons.

The directory named a technical layer, not a subject. `Layers/` grouped by "these are all Layers", which is true of the whole package and therefore says nothing. The unit that actually changes is one provider.

The rest of `packages/server` already follows a `Services/` and `Layers/` split per domain, in PascalCase. That convention is consistent across ten domains and is not the problem.

## Decision

- Give every provider its own folder under `Layers/`: `Layers/Claude/`, `Layers/Codex/`, `Layers/Copilot/`, `Layers/Cursor/`, `Layers/OpenCode/`.
- Use the same filenames in every provider folder. The role is in the filename, the provider is in the folder name.

| File | Holds | Rule |
|------|-------|------|
| `Provider.ts` | id, capabilities, presence probe, executable resolution, `adapterError` | no intra-folder imports. it is the acyclic root |
| `Facts.ts` | the contract fact vocabulary, fact constructors, terminal-fact predicate | schemas and literals only |
| `Tools.ts` | the provider's tool-name taxonomy: kind detection, titles, path and input hints | pure. changes when the provider ships a new tool |
| `Map.ts` | inbound. raw provider message becomes contract facts, plus the stream state it needs | pure. no Effect, no I/O, no clock |
| `Wire.ts` | outbound. request payload builders, url and method tables, framing and id parsing | pure, same rule as `Map.ts` |
| `Codec.ts` | `encodeContractFact`, `decodeContractFact`, fact to and from ACP session update | pure. round-trippable |
| `Adapter.ts` | the session lifecycle: ordering, cancel, permission gate, stall recovery | the only file with fibers, queues and scopes |

- Split `Adapter.ts` further only when a concern is genuinely separable and the file is large. Use `Permissions.ts`, `Watchdog.ts`, `Process.ts`, `Session.ts`, `TurnTracking.ts`, in that vocabulary, and keep `Adapter.ts` as the spine that names and orders them. `TurnTracking.ts` is the turn state machine: what counts as a new turn against a steer, and which stop reason wins when a superseded prompt settles last. Only Copilot needs it today.
- Use `Config.ts` when a provider reads its own on-disk configuration and the parser is large enough to crowd out the descriptor. Only Codex needs it today, for a TOML reader.
- Put the live transport handle type in `Process.ts`, never in `Adapter.ts`. A spine that its own limbs import from is not a spine, and `Session.ts` needs that type.
- Never re-export a moved symbol from `Adapter.ts` to preserve an import path. Point the importer at the file that holds the code. A re-export block is the barrel this ADR forbids, spelled differently.
- Keep the shared kernel flat in `Layers/`: `ProviderRegistry.ts`, `ProviderAdapterRegistry.ts`, `ProviderBridge.ts`, `AgentInstaller.ts`, `Json.ts`, `FactCodec.ts`. These know every provider and no provider's details.
- Read raw provider JSON only through `Json.ts`. Five hand-copied accessor kits were the same 230 lines five times.
- Keep the ports in `provider/Services/`. A provider folder implements a port; it never declares one.
- Keep each `*.test.ts` beside the file it tests.
- Add no barrel `index.ts`. Subpath exports in `package.json` are the public surface, and a barrel would hide which file a symbol comes from.
- Do not name a file `Projection.ts`. In `CONTEXT.md`, a provider projection is a mirrored external object, not a display mapping.

## Consequences

**Better**

- "Where is the permission gate for Cursor" is a path, not a search: `Layers/Cursor/Permissions.ts`.
- A provider is added or removed as one folder.
- Each file has one reason to change, so a diff names its own intent.
- The pure files stay pure, which keeps them testable with literals and no runtime.

**Costs**

- Import paths inside a provider folder gain one `../` level.
- Five folders now carry the same filenames, so an editor tab strip shows `Adapter.ts` more than once. Full paths in the file switcher, not tab titles, become the way to navigate.
- The move rewrites `package.json` subpath exports and every import site at once.

## Alternatives rejected

- **Leave the files flat and only rename them consistently:** fixes guessability, leaves 1000-line files holding five reasons to change.
- **Split by line count:** a 500-line cap cuts through a cohesive unit as readily as between two. Cohesion decides the seam.
- **One `Map.ts` for both directions:** the first pass tried it. Outbound payload builders are pure, so they fell into `Map.ts` for lack of a shelf, and `Process.ts` then imported a cluster of url builders out of a file named for inbound translation. `Wire.ts` names the direction.
- **A per-folder copy of the JSON accessors:** tried, and it drifted immediately. Two folders exported `jsonObjectOf`, one kept it private and a third file re-inlined it.
- **Convert all of `packages/server` to package-by-feature:** the `Services/` and `Layers/` convention is consistent across ten domains and carries no cost there. Changing it would be a large diff that buys nothing for the domains that hold one implementation.
- **A barrel `index.ts` per provider folder:** re-exports hide provenance and let a pure file import an effectful one without the reader noticing.
