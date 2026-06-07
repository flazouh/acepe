#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const chunks = [];
for await (const chunk of process.stdin) {
	chunks.push(chunk);
}

JSON.parse(chunks.join(""));

function git(args) {
	return execFileSync("git", args, {
		cwd: process.cwd(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function repoRoot() {
	return git(["rev-parse", "--show-toplevel"]).trim();
}

function changedFiles(root) {
	const tracked = git(["diff", "--name-only", "HEAD", "--"]).split("\n");
	const untracked = git(["ls-files", "--others", "--exclude-standard"]).split("\n");
	return tracked.concat(untracked).map((file) => file.trim()).filter((file) => file.length > 0);
}

function isUiFile(file) {
	if (file.startsWith("packages/desktop/static/")) return true;
	if (file.startsWith("packages/ui/src/")) return true;
	if (file.startsWith("packages/desktop/src/")) {
		return (
			file.endsWith(".svelte") ||
			file.endsWith(".css") ||
			file.includes("/components/") ||
			file.includes("/acp/components/")
		);
	}
	return false;
}

function newestMtimeMs(root, files) {
	return Math.max(...files.map((file) => statSync(join(root, file)).mtimeMs));
}

function block(reason) {
	process.stdout.write(`${JSON.stringify({ continue: true, decision: "block", reason })}\n`);
}

const root = repoRoot();
const uiFiles = changedFiles(root).filter(isUiFile).filter((file) => existsSync(join(root, file)));

if (uiFiles.length === 0) {
	process.stdout.write(`${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
	process.exit(0);
}

const evidencePath = join(root, ".codex", "state", "ui-qa-evidence.json");
if (!existsSync(evidencePath)) {
	block(
		`UI files changed but no Acepe QA evidence exists. Run a real UI QA command from packages/desktop, for example: bun run qa inspect --selector=<changed-area> --limit=1, bun run qa screenshot, or bun run qa observe. Changed UI files: ${uiFiles.slice(0, 8).join(", ")}`
	);
	process.exit(0);
}

const evidenceMtime = statSync(evidencePath).mtimeMs;
const uiMtime = newestMtimeMs(root, uiFiles);

if (evidenceMtime < uiMtime) {
	block(
		`UI files changed after the latest Acepe QA evidence. Re-run UI QA against the changed screen before finishing. Latest evidence: ${evidencePath}. Changed UI files: ${uiFiles.slice(0, 8).join(", ")}`
	);
	process.exit(0);
}

process.stdout.write(`${JSON.stringify({ continue: true, suppressOutput: true })}\n`);
