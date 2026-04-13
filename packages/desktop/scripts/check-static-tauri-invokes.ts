#!/usr/bin/env bun

import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import {
	ALLOWED_STATIC_TAURI_INVOKES,
} from "../src/lib/utils/tauri-client/non-registry-command-allowlist.js";

const DESKTOP_ROOT = join(import.meta.dir, "..");
const SOURCE_ROOT = join(DESKTOP_ROOT, "src", "lib");
const SOURCE_EXTENSIONS = new Set([".ts", ".svelte"]);
const STATIC_INVOKE_PATTERN = /\binvoke(?:<[^>]+>)?\(\s*["']([^"']+)["']/g;
const SKIPPED_FILES = new Set(["src/lib/utils/tauri-client/non-registry-command-allowlist.ts"]);

type Violation = {
	filePath: string;
	command: string;
};

function walkFiles(root: string): string[] {
	const entries = readdirSync(root);
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = join(root, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...walkFiles(fullPath));
			continue;
		}

		if (SOURCE_EXTENSIONS.has(extname(fullPath))) {
			files.push(fullPath);
		}
	}

	return files;
}

function isAllowed(filePath: string, command: string): boolean {
	return ALLOWED_STATIC_TAURI_INVOKES.some((entry) => {
		return entry.filePath === filePath && entry.command === command;
	});
}

function main(): void {
	const violations: Violation[] = [];

	for (const absolutePath of walkFiles(SOURCE_ROOT)) {
		const contents = readFileSync(absolutePath, "utf8");
		const relativePath = relative(DESKTOP_ROOT, absolutePath);
		if (SKIPPED_FILES.has(relativePath)) {
			continue;
		}

		for (const match of contents.matchAll(STATIC_INVOKE_PATTERN)) {
			const command = match[1];
			if (!isAllowed(relativePath, command)) {
				violations.push({
					filePath: relativePath,
					command,
				});
			}
		}
	}

	if (violations.length === 0) {
		console.log("No unallowlisted static Tauri invokes found.");
		return;
	}

	console.error("Found static Tauri invokes outside the allowlist:");
	for (const violation of violations) {
		console.error(`- ${violation.filePath}: ${violation.command}`);
	}
	console.error(
		"\nMove these callsites to TAURI_COMMAND_CLIENT/typed wrappers or add a documented allowlist entry."
	);
	process.exit(1);
}

main();
