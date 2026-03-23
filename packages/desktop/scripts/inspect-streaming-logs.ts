#!/usr/bin/env bun
/**
 * Inspect streaming logs to discover agent-specific tool call update formats.
 *
 * Run a session with Cursor or Codex, trigger tool calls, then run:
 *   bun run scripts/inspect-streaming-logs.ts
 *
 * Log path: packages/desktop/src-tauri/logs/streaming/{sessionId}.jsonl
 * (Only written in debug builds; logs/ is gitignored)
 *
 * Output: Extracts tool-related events, infers agent from field patterns,
 * and reports any streaming-related fields found.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const LOGS_DIR = join(import.meta.dir, "../src-tauri/logs/streaming");

type LogEntry = {
	timestamp?: string;
	data?: unknown;
};

function extractUpdatePayload(data: unknown): unknown {
	if (!data || typeof data !== "object") return null;
	const obj = data as Record<string, unknown>;

	// JSON-RPC notification: { jsonrpc, method, params: { sessionId, update: {...} } }
	const params = obj.params as Record<string, unknown> | undefined;
	if (params) {
		if (params.update) return params.update;
		if ("sessionUpdate" in params || "toolCallId" in params || "tool_use_id" in params) {
			return params;
		}
	}
	// Already flat / direct
	if ("sessionUpdate" in obj || "toolCallId" in obj || "tool_use_id" in obj || "type" in obj) {
		return obj;
	}
	// OpenCode SSE: data.payload.properties.part
	const payload = obj.payload as Record<string, unknown> | undefined;
	const part =
		payload?.properties && typeof payload.properties === "object"
			? (payload.properties as Record<string, unknown>).part
			: undefined;
	if (part) return part;
	// OpenCode alternate: properties at top level
	if (obj.properties) return obj;
	return obj;
}

function isToolRelated(payload: unknown): boolean {
	if (!payload || typeof payload !== "object") return false;
	const o = payload as Record<string, unknown>;

	// Explicit session update type
	const sessionUpdate = o.sessionUpdate ?? o.session_update;
	if (
		typeof sessionUpdate === "string" &&
		["toolCallUpdate", "tool_call_update", "toolCall", "tool_call"].includes(sessionUpdate)
	) {
		return true;
	}

	// Type field (Cursor/Anthropic-like)
	const type = o.type;
	if (typeof type === "string" && ["tool_result", "tool_use"].includes(type)) {
		return true;
	}

	// Tool identifiers
	if ("toolCallId" in o || "tool_use_id" in o || "toolUseId" in o) return true;

	// OpenCode: part with tool/callID (or we are the part)
	if (o.part) {
		const part = o.part as Record<string, unknown>;
		if ("tool" in part || "callID" in part) return true;
	}
	if (("tool" in o && typeof o.tool === "string") || "callID" in o) return true;

	return false;
}

function inferAgent(payload: unknown): string {
	if (!payload || typeof payload !== "object") return "unknown";
	const o = payload as Record<string, unknown>;

	// Claude Code: _meta.claudeCode
	if (o._meta && typeof o._meta === "object") {
		const meta = o._meta as Record<string, unknown>;
		if (meta.claudeCode) return "ClaudeCode";
		if (meta.codex) return "Codex";
		if (meta.openCode) return "OpenCode";
		if (meta.cursor) return "Cursor";
	}

	// Field-based heuristics
	if ("tool_use_id" in o) return "Cursor (tool_use_id)";
	if ("toolUseId" in o) return "OpenCode (toolUseId)";
	if ("toolCallId" in o && o._meta) return "ClaudeCode or Codex (toolCallId + _meta)";
	if ("toolCallId" in o) return "Codex? (toolCallId, no _meta)";

	// OpenCode SSE: part has tool, callID
	if ("tool" in o && "callID" in o) return "OpenCode (tool+callID)";
	if (o.properties?.part) return "OpenCode (SSE part)";

	return "unknown";
}

function hasStreamingFields(payload: unknown): { has: boolean; path?: string } {
	if (!payload || typeof payload !== "object") return { has: false };
	const o = payload as Record<string, unknown>;

	// _meta.claudeCode.streamingInputDelta
	const meta = o._meta as Record<string, unknown> | undefined;
	if (meta?.claudeCode && typeof meta.claudeCode === "object") {
		const cc = meta.claudeCode as Record<string, unknown>;
		if (cc.streamingInputDelta) return { has: true, path: "_meta.claudeCode.streamingInputDelta" };
	}
	// _meta.codex.streamingInputDelta (hypothetical)
	if (meta?.codex && typeof meta.codex === "object") {
		const cx = meta.codex as Record<string, unknown>;
		if (cx.streamingInputDelta) return { has: true, path: "_meta.codex.streamingInputDelta" };
	}
	// Top-level
	if (o.streamingInputDelta) return { has: true, path: "streamingInputDelta" };

	return { has: false };
}

function sampleKeys(obj: unknown, maxKeys = 15): string[] {
	if (!obj || typeof obj !== "object") return [];
	const o = obj as Record<string, unknown>;
	let keys = Object.keys(o);
	if (keys.length > maxKeys) {
		keys = keys.slice(0, maxKeys);
		keys.push("...");
	}
	return keys;
}

async function main() {
	let logDir: string[];
	try {
		logDir = await readdir(LOGS_DIR);
	} catch (err) {
		console.error("Could not read logs directory:", LOGS_DIR);
		console.error("Ensure you've run a session in debug build. Logs are gitignored.");
		console.error((err as Error).message);
		process.exit(1);
	}

	const jsonlFiles = logDir.filter((f) => f.endsWith(".jsonl"));
	if (jsonlFiles.length === 0) {
		console.log("No .jsonl files in", LOGS_DIR);
		console.log("Run a session with an agent (Claude Code, Cursor, Codex) and trigger tool calls.");
		process.exit(0);
	}

	console.log("=== Streaming Log Inspection ===\n");
	console.log(`Found ${jsonlFiles.length} log file(s)\n`);

	for (const file of jsonlFiles.sort()) {
		const path = join(LOGS_DIR, file);
		const content = await readFile(path, "utf-8");
		const lines = content.trim().split("\n").filter(Boolean);

		const toolEvents: Array<{
			lineNum: number;
			payload: unknown;
			agent: string;
			streaming: { has: boolean; path?: string };
			keys: string[];
		}> = [];

		for (let i = 0; i < lines.length; i++) {
			try {
				const entry = JSON.parse(lines[i]) as LogEntry;
				const payload = extractUpdatePayload(entry.data);

				if (payload && isToolRelated(payload)) {
					toolEvents.push({
						lineNum: i + 1,
						payload,
						agent: inferAgent(payload),
						streaming: hasStreamingFields(payload),
						keys: sampleKeys(payload),
					});
				}
			} catch {
				// Skip malformed lines
			}
		}

		console.log(`## ${file} (${lines.length} lines, ${toolEvents.length} tool-related)\n`);

		if (toolEvents.length === 0) {
			console.log("  No tool call/update events found.\n");
			continue;
		}

		// Dedupe by agent for summary
		const byAgent = new Map<string, number>();
		const withStreaming = toolEvents.filter((e) => e.streaming.has);
		for (const e of toolEvents) {
			byAgent.set(e.agent, (byAgent.get(e.agent) ?? 0) + 1);
		}
		console.log("  By inferred agent:", Object.fromEntries(byAgent));
		if (withStreaming.length > 0) {
			console.log("  With streaming fields:", withStreaming.length);
			for (const e of withStreaming.slice(0, 3)) {
				console.log(`    - Line ${e.lineNum}: ${e.streaming.path}`);
			}
		}
		console.log("");

		// Sample first tool call update from each agent
		const seen = new Set<string>();
		for (const e of toolEvents) {
			const key = `${e.agent}-${e.keys.join(",")}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const isUpdate =
				(e.payload as Record<string, unknown>).sessionUpdate === "toolCallUpdate" ||
				(e.payload as Record<string, unknown>).session_update === "tool_call_update" ||
				(e.payload as Record<string, unknown>).type === "tool_result";

			if (isUpdate) {
				console.log(`  Sample tool call update (${e.agent}), line ${e.lineNum}:`);
				console.log("    Keys:", e.keys.join(", "));
				if (e.streaming.has) {
					console.log("    Streaming:", e.streaming.path);
				}
				// Show _meta keys if present
				const meta = (e.payload as Record<string, unknown>)._meta as
					| Record<string, unknown>
					| undefined;
				if (meta) {
					console.log("    _meta keys:", Object.keys(meta).join(", "));
				}
				console.log("");
			}
		}

		console.log("");
	}

	console.log("---");
	console.log(
		"Next: Update docs/plans/2026-02-15-agent-streaming-formats-research.md with findings."
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
