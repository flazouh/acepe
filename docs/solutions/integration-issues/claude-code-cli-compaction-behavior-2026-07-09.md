---
title: General guide to Claude Code CLI compaction behavior
date: 2026-07-09
category: integration-research
module: claude-code-cli
problem_type: research_report
component: cli
severity: medium
tags:
  - claude-code
  - claude-cli
  - compaction
  - compact-boundary
  - provider-history
  - usage-telemetry
---

# General Guide To Claude Code CLI Compaction Behavior

## Executive Summary

Claude Code CLI can compact long conversations. Compaction means it replaces older conversation context with a shorter summary so the same session can continue with less token pressure.

For integrations, the most useful durable signal is usually a transcript record with:

```text
type = system
subtype = compact_boundary
```

The persisted record commonly looks like this:

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 470542,
    "postTokens": 44577,
    "durationMs": 6
  }
}
```

Do not build detection around UI text like `Compaction done`. UI/status text may change. The safer durable signal is:

```text
subtype == "compact_boundary"
```

## Mental Model

Compaction is a context rewrite.

Simple flow:

```text
manual /compact or automatic threshold
        |
        v
PreCompact hook phase
        |
        v
summary generation or reuse of a prepared summary
        |
        v
compact_boundary record
        |
        v
PostCompact hook phase
```

After compaction:

- the active conversation context becomes smaller
- older content may be represented by a summary
- token usage drops from the active context view
- the transcript keeps a boundary marker
- metadata can describe before/after token counts

## Where To Look

Claude Code transcript history is commonly stored under a user-level Claude directory, often shaped like:

```text
~/.claude/projects/**/<session-id>.jsonl
```

Treat that path as a common default, not a universal contract. A robust implementation should allow the transcript root to be configured.

Search for compaction records by looking for:

```text
"subtype":"compact_boundary"
Conversation compacted
compactMetadata
```

Example command:

```bash
rg -n '"subtype":"compact_boundary"|Conversation compacted|compactMetadata' ~/.claude/projects
```

## Main Transcript Shape

The useful Claude Code compaction record is a system message:

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "compactMetadata": {
    "trigger": "manual",
    "preTokens": 250000,
    "postTokens": 12000,
    "durationMs": 80000
  }
}
```

Important parts:

| Field | Meaning |
|---|---|
| `type` | Usually `system` for the boundary record. |
| `subtype` | `compact_boundary` is the key durable marker. |
| `content` | Human-readable text, commonly `Conversation compacted`. |
| `compactMetadata` | Provider metadata about the compaction. |

## Metadata Fields

Fields that may appear inside `compactMetadata`:

| Field | Meaning |
|---|---|
| `trigger` | Why compaction happened. Known examples: `auto`, `manual`. |
| `preTokens` | Estimated token count before compaction. |
| `postTokens` | Estimated token count after compaction. |
| `durationMs` | Duration reported by Claude Code. |
| `precomputed` | May indicate the compaction summary was prepared ahead of time. |
| `preCompactDiscoveredTools` | Tools known before compaction. |
| `preservedSegment` | Segment retained through compaction. |
| `preservedMessages` | Number of messages retained through compaction. |
| `cumulativeDroppedTokens` | Total dropped tokens across compactions, when provided. |

Treat every metadata field as optional except the boundary identity itself. Claude Code can add, remove, or rename internal metadata across versions.

## Manual vs Automatic Compaction

`trigger` commonly answers how compaction started.

```text
manual
auto
```

`manual` usually means the user or caller requested compaction directly, for example with `/compact`.

`auto` means Claude Code decided to compact automatically, usually because the active context was getting too large.

Do not hardcode the automatic threshold. It can depend on:

- Claude Code version
- selected model
- active context window
- internal summarization strategy
- whether a prepared summary is available

## Precomputed Compaction

Some records may include:

```json
{
  "precomputed": true
}
```

When `precomputed` is true, `durationMs` may be very small. That does not always mean the whole summary was created in a few milliseconds. It may mean Claude Code prepared the summary earlier and only applied it at the boundary.

Implementation rule:

```text
durationMs is useful telemetry, not a guaranteed measure of total summarization cost.
```

## Usage Update Shape

Some integrations may also see a usage reset shape like:

```json
{
  "sessionId": "session-id",
  "compaction": true,
  "size": 200000
}
```

This is useful, but it is weaker than `compact_boundary`.

Difference:

```text
usage_update with compaction=true
  tells you "usage reset happened"

compact_boundary
  tells you "compaction happened", why it happened, token counts before and after, and timing metadata
```

For historical reconstruction, prefer `compact_boundary` when available. Use `usage_update.compaction == true` as a supporting signal.

## Live Stream vs Transcript History

Do not assume live streaming events and transcript history expose compaction the same way.

Claude Code may expose lightweight live usage updates while keeping richer compaction details in transcript history.

Practical rule:

```text
Historical Claude Code compaction:
  parse transcript JSONL records with subtype = compact_boundary

Live usage reset:
  watch for usage updates with compaction = true, if exposed
```

## Recommended Data Model

If a tool needs to track Claude Code compaction, normalize transcript records into a small app-owned model.

Suggested shape:

```text
ClaudeCodeCompactionEvent
  session_id: string
  event_id: stable integration id
  source: live-stream | provider-history
  trigger: auto | manual | unknown
  status: boundary | usage-reset
  pre_tokens: number?
  post_tokens: number?
  dropped_tokens: number?
  duration_ms: number?
  occurred_at: timestamp?
  raw_provider_metadata: json
```

Input mapping:

| Source | Input shape | Suggested mapping |
|---|---|---|
| Claude Code transcript | `system.subtype = compact_boundary` | completed/boundary event with metadata |
| Claude Code usage telemetry | `usage_update` with `compaction: true` | usage reset signal |

Keep the original Claude payload as raw metadata. Promote only stable common fields into typed fields.

## Implementation Advice

1. Make the Claude transcript root configurable.
2. Parse JSONL transcript files incrementally.
3. Detect records where `type == "system"` and `subtype == "compact_boundary"`.
4. Read `compactMetadata`, but treat all fields as optional.
5. Promote common fields:
   - `trigger`
   - `preTokens`
   - `postTokens`
   - `durationMs`
   - `cumulativeDroppedTokens`
6. Preserve unknown metadata fields.
7. Support unknown future `trigger` values by mapping them to `unknown` or preserving the raw value.
8. Use numeric types large enough for token counts over 1,000,000.
9. Treat `usage_update.compaction == true` as a usage reset, not as the full compaction event.
10. Do not hardcode UI text such as `Compaction done`.

## Test Cases To Add

Add parser tests for:

- automatic compaction
- manual compaction
- missing `compactMetadata`
- missing `precomputed`
- high `preTokens` values
- unknown `trigger` value
- `usage_update.compaction == true`
- malformed JSONL lines around valid compaction records
- multiple compact boundaries in one session

Example minimal fixture:

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted",
  "compactMetadata": {
    "trigger": "auto",
    "preTokens": 180000,
    "postTokens": 22000,
    "durationMs": 12,
    "precomputed": true
  }
}
```

Example missing-metadata fixture:

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "content": "Conversation compacted"
}
```

## Edge Cases And Risks

- `durationMs` can be tiny when `precomputed: true`.
- `preTokens` can be very large.
- `trigger` can have future values.
- `compactMetadata` may gain new fields in future Claude Code releases.
- Live streams may not include the same detail as transcript history.
- UI/status text can change.
- Claude Code version matters. Do not depend on one observed version's full internal shape.

## Reproduction Commands

Find Claude compact boundaries in transcript history:

```bash
rg -n '"subtype":"compact_boundary"|Conversation compacted|compactMetadata' ~/.claude/projects
```

Search a stream log directory for possible compaction-like signals:

```bash
rg -n 'compact_boundary|Conversation compacted|"compaction":true' /path/to/streaming/logs
```

Inspect a Claude Code binary for compaction-related internal strings:

```bash
strings /path/to/claude | rg -i 'compact|precompact|postcompact'
```

Summarize compact boundaries from a transcript root:

```bash
node - <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2] || path.join(process.env.HOME, ".claude/projects");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!entry.name.endsWith(".jsonl")) continue;

    const lines = fs.readFileSync(fullPath, "utf8").split("\n");

    lines.forEach((line, index) => {
      if (!line.includes('"compact_boundary"')) return;

      const record = JSON.parse(line);
      const metadata = record.compactMetadata || {};

      console.log([
        fullPath,
        index + 1,
        record.timestamp || "",
        record.version || "",
        metadata.trigger || "",
        metadata.preTokens || "",
        metadata.postTokens || "",
        metadata.durationMs || "",
        metadata.precomputed || ""
      ].join("\t"));
    });
  }
}

walk(root);
NODE
```

Usage:

```bash
node summarize-compact-boundaries.js /path/to/transcript/root
```

## Bottom Line

For Claude Code CLI, treat `compact_boundary` transcript records as the durable compaction source of truth.

Use usage reset events as secondary hints.

Avoid depending on UI strings, one machine's file layout, or one Claude Code version's internal metadata details.
