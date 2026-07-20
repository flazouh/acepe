#!/usr/bin/env bun
/**
 * Path-aware pre-push checks that mirror `.github/workflows/ci.yml`.
 *
 * Usage:
 *   bun scripts/git-hooks/pre-push-affected.ts [file...]
 *
 * When no files are passed, diffs against the upstream tracking branch
 * (or origin/main) to determine the push set.
 */
import { spawnSync } from "node:child_process";

import {
	classifyPushFiles,
	shouldRunDesktop,
	shouldRunGpuiPoc,
	shouldRunTauriBackend,
	shouldRunUi,
	shouldRunWebsite,
} from "./pre-push-affected-lib.ts";

function resolvePushFiles(argvFiles: readonly string[]): string[] {
	if (argvFiles.length > 0) {
		return argvFiles.filter((file) => file.length > 0);
	}

	const upstream = spawnSync(
		"git",
		["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
		{
			encoding: "utf8",
		},
	);
	const base =
		upstream.status === 0 && upstream.stdout.trim().length > 0
			? upstream.stdout.trim()
			: "origin/main";

	const diff = spawnSync("git", ["diff", "--name-only", `${base}...HEAD`], {
		encoding: "utf8",
	});
	if (diff.status !== 0) {
		console.error(`Failed to resolve push files against ${base}`);
		console.error(diff.stderr);
		process.exit(1);
	}
	return diff.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function run(
	label: string,
	command: string,
	args: readonly string[],
	cwd?: string,
): void {
	console.log(`\n→ ${label}`);
	const result = spawnSync(command, [...args], {
		cwd,
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) {
		console.error(`\n✖ ${label} failed`);
		process.exit(result.status ?? 1);
	}
}

function runShell(label: string, command: string, cwd?: string): void {
	console.log(`\n→ ${label}`);
	const result = spawnSync(command, {
		cwd,
		stdio: "inherit",
		env: process.env,
		shell: true,
	});
	if (result.status !== 0) {
		console.error(`\n✖ ${label} failed`);
		process.exit(result.status ?? 1);
	}
}

const files = resolvePushFiles(process.argv.slice(2));
if (files.length === 0) {
	console.log(
		"No push files detected; running repo-wide structural guard only.",
	);
}

const affected = classifyPushFiles(files);
const runDesktop = shouldRunDesktop(affected);
const runWebsite = shouldRunWebsite(affected);
const runUi = shouldRunUi(affected);
const runTauriBackend = shouldRunTauriBackend(affected);
const runGpuiPoc = shouldRunGpuiPoc(affected);

console.log("Pre-push affected sets:");
console.log(
	JSON.stringify(
		{
			files: files.length,
			runDesktop,
			runWebsite,
			runUi,
			runTauriBackend,
			runGpuiPoc,
		},
		null,
		2,
	),
);

// Always — mirrors CI structural_forbid job.
run("structural test guard", "bun", [
	"scripts/forbid-structural-tests.ts",
	"packages",
]);
run("dependency audit", "bun", ["run", "audit"]);

if (runDesktop) {
	run(
		"desktop biome",
		"bunx",
		["@biomejs/biome", "check", "--diagnostic-level=error", "."],
		"packages/desktop",
	);
	runShell("desktop check", "bun run check", "packages/desktop");
	runShell("desktop check:svelte", "bun run check:svelte", "packages/desktop");
	runShell("desktop test", "bun run test", "packages/desktop");
}

if (runWebsite) {
	run(
		"website biome",
		"bunx",
		["@biomejs/biome", "check", "--diagnostic-level=error", "."],
		"packages/website",
	);
	runShell("website check", "bun run check", "packages/website");
	runShell("website test", "bun run test", "packages/website");
}

if (runUi) {
	runShell("ui check", "bun run check", "packages/ui");
	runShell("ui test", "bun test", "packages/ui");
}

if (runTauriBackend) {
	runShell(
		"tauri clippy",
		"cargo clippy --no-default-features -- -D warnings",
		"packages/desktop/src-tauri",
	);
	runShell(
		"tauri test",
		"cargo nextest run --no-default-features -E 'not test(claude_history::export_types)'",
		"packages/desktop/src-tauri",
	);
}

if (runGpuiPoc) {
	runShell(
		"gpui-agent-panel-poc clippy",
		"cargo clippy -- -D warnings",
		"packages/gpui-agent-panel-poc",
	);
	runShell(
		"gpui-agent-panel-poc test",
		"cargo test",
		"packages/gpui-agent-panel-poc",
	);
}

if (
	!runDesktop &&
	!runWebsite &&
	!runUi &&
	!runTauriBackend &&
	!runGpuiPoc &&
	files.length > 0
) {
	console.log(
		"\nNo package-specific frontend/backend checks required for this push set.",
	);
}

console.log("\n✔ Pre-push checks passed");
