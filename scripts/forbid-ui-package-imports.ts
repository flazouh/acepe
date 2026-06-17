import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { findForbiddenImportRule } from "./ui-package-forbidden-import-rules.js";

const SOURCE_FILE_PATTERN = /\.(?:ts|svelte|js)$/;
const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".svelte-kit",
	"dist",
	"build",
	"__tests__",
	"fixtures",
]);

interface ImportViolation {
	filePath: string;
	specifier: string;
	ruleId: string;
}

function collectSourceFiles(rootPath: string): string[] {
	const stats = statSync(rootPath);
	if (!stats.isDirectory()) {
		return SOURCE_FILE_PATTERN.test(rootPath) ? [rootPath] : [];
	}

	const results: string[] = [];
	for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
		if (SKIP_DIR_NAMES.has(entry.name)) {
			continue;
		}

		results.push(...collectSourceFiles(join(rootPath, entry.name)));
	}
	return results;
}

function stripBlockComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripLineComments(source: string): string {
	return source
		.split("\n")
		.map((line) => line.replace(/\/\/.*$/, ""))
		.join("\n");
}

function extractScriptBlocks(source: string, filePath: string): string[] {
	if (!filePath.endsWith(".svelte")) {
		return [source];
	}

	const blocks: string[] = [];
	const scriptPattern = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
	let match = scriptPattern.exec(source);
	while (match !== null) {
		blocks.push(match[1] ?? "");
		match = scriptPattern.exec(source);
	}
	return blocks.length > 0 ? blocks : [];
}

function extractImportSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const staticImportPattern =
		/\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?["']([^"']+)["']/g;
	const dynamicImportPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

	let match = staticImportPattern.exec(source);
	while (match !== null) {
		const specifier = match[1];
		if (specifier !== undefined) {
			specifiers.push(specifier);
		}
		match = staticImportPattern.exec(source);
	}

	match = dynamicImportPattern.exec(source);
	while (match !== null) {
		const specifier = match[1];
		if (specifier !== undefined) {
			specifiers.push(specifier);
		}
		match = dynamicImportPattern.exec(source);
	}

	return specifiers;
}

function scanFile(filePath: string): ImportViolation[] {
	const rawSource = readFileSync(filePath, "utf8");
	const scriptBlocks = extractScriptBlocks(rawSource, filePath);
	const violations: ImportViolation[] = [];

	for (const block of scriptBlocks) {
		const source = stripLineComments(stripBlockComments(block));
		for (const specifier of extractImportSpecifiers(source)) {
			const rule = findForbiddenImportRule(specifier);
			if (rule !== null) {
				violations.push({
					filePath,
					specifier,
					ruleId: rule.id,
				});
			}
		}
	}

	return violations;
}

const roots = process.argv.slice(2);
if (roots.length === 0) {
	console.error("Usage: bun scripts/forbid-ui-package-imports.ts <path> [path...]");
	process.exit(1);
}

const violations: ImportViolation[] = [];

for (const root of roots) {
	for (const filePath of collectSourceFiles(root)) {
		violations.push(...scanFile(filePath));
	}
}

if (violations.length > 0) {
	console.error("Forbidden @acepe/ui imports found:");
	for (const violation of violations) {
		console.error(
			`- ${violation.filePath}: "${violation.specifier}" (${violation.ruleId})`
		);
	}
	process.exit(1);
}
