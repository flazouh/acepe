#!/usr/bin/env bun
import { join } from "node:path";

/**
 * Audit historical session load timing.
 *
 * Usage:
 *   bun run scripts/audit-session-timing.ts <sessionId> <projectPath> <agentId> [sourcePath]
 *
 * Example:
 *   bun run scripts/audit-session-timing.ts abc-123 /Users/me/project cursor
 *   bun run scripts/audit-session-timing.ts abc-123 /Users/me/project cursor /path/to/transcript.json
 *
 * Runs: cargo run --manifest-path src-tauri/Cargo.toml -- --audit-session ...
 * Parses JSON output and prints a formatted table.
 */

interface TimingStage {
	name: string;
	ms: number;
}

interface SessionLoadTiming {
	agent: string;
	total_ms: number;
	stages: TimingStage[];
	entry_count: number;
	ok: boolean;
}

function printUsage(): void {
	console.error(`
Usage: bun run scripts/audit-session-timing.ts <sessionId> <projectPath> <agentId> [sourcePath]

  sessionId   - Session ID to audit
  projectPath - Absolute path to the project
  agentId     - Agent identifier (claude-code, cursor, codex)
  sourcePath  - Optional source file path for O(1) Cursor lookup

Examples:
  bun run scripts/audit-session-timing.ts abc-123 /Users/me/project claude-code
  bun run scripts/audit-session-timing.ts abc-123 /Users/me/project cursor /path/to/transcript.json

Note: OpenCode audit requires the running app (use in-app invoke).
`);
}

function formatTable(timing: SessionLoadTiming): void {
	const total = timing.total_ms;
	const maxNameLen = Math.max("Stage".length, ...timing.stages.map((s) => s.name.length));
	const nameCol = maxNameLen + 2;

	console.log("\nSession Load Timing Report");
	console.log("=========================");
	console.log(`Agent: ${timing.agent}`);
	console.log(`Total: ${timing.total_ms} ms`);
	console.log(`Entries: ${timing.entry_count}`);
	console.log(`Status: ${timing.ok ? "OK" : "Not found"}`);
	console.log("");

	const header = `${"Stage".padEnd(nameCol) + "ms".padStart(8)}  %`;
	console.log(header);
	console.log("-".repeat(nameCol + 8 + 4));

	let maxMs = 0;
	for (const s of timing.stages) {
		if (s.ms > maxMs) maxMs = s.ms;
	}

	for (const s of timing.stages) {
		const pct = total > 0 ? Math.round((s.ms / total) * 100) : 0;
		const pctStr = `${pct}%`;
		const marker = s.ms === maxMs && timing.stages.length > 1 ? "  <-- bottleneck" : "";
		console.log(
			s.name.padEnd(nameCol) + String(s.ms).padStart(8) + String(pctStr).padStart(5) + marker
		);
	}
	console.log("");
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	if (args.length < 3) {
		printUsage();
		process.exit(1);
	}

	const [sessionId, projectPath, agentId, sourcePath] = args;

	const desktopDir = join(import.meta.dir, "..");
	const manifestPath = join(desktopDir, "src-tauri", "Cargo.toml");

	const cargoArgs = [
		"run",
		"--manifest-path",
		manifestPath,
		"--",
		"--audit-session",
		sessionId,
		projectPath,
		agentId,
		...(sourcePath ? [sourcePath] : []),
	];

	const proc = Bun.spawn(["cargo", ...cargoArgs], {
		cwd: desktopDir || process.cwd(),
		stdout: "pipe",
		stderr: "inherit",
	});

	const output = await new Response(proc.stdout).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		process.exit(exitCode);
	}

	let timing: SessionLoadTiming;
	try {
		timing = JSON.parse(output) as SessionLoadTiming;
	} catch {
		console.error("Failed to parse JSON output:");
		console.error(output);
		process.exit(1);
	}

	formatTable(timing);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
