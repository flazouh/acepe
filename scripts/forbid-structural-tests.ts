import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TEST_FILE_PATTERN = /(?:\.test|\.spec|\.vitest)\.ts$/;
const FORBIDDEN_PATTERN = /\b(?:readFileSync|existsSync)\s*\(/;

function collectFiles(rootPath: string): string[] {
	const stats = statSync(rootPath);
	if (!stats.isDirectory()) {
		return TEST_FILE_PATTERN.test(rootPath) ? [rootPath] : [];
	}

	const results: string[] = [];
	for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
		if (
			entry.name === "node_modules" ||
			entry.name === ".svelte-kit" ||
			entry.name === "dist" ||
			entry.name === "build"
		) {
			continue;
		}

		results.push(...collectFiles(join(rootPath, entry.name)));
	}
	return results;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
	console.error("Usage: bun scripts/forbid-structural-tests.ts <path> [path...]");
	process.exit(1);
}

const violations: string[] = [];

for (const root of roots) {
	for (const filePath of collectFiles(root)) {
		const source = readFileSync(filePath, "utf8");
		if (FORBIDDEN_PATTERN.test(source)) {
			violations.push(filePath);
		}
	}
}

if (violations.length > 0) {
	console.error("Forbidden structural source-inspection tests found:");
	for (const filePath of violations) {
		console.error(`- ${filePath}`);
	}
	process.exit(1);
}
