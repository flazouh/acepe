import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const UI_PACKAGE_ROOT = join(REPO_ROOT, "packages/ui/src");

const SOURCE_FILE_PATTERN = /\.(?:ts|svelte|js)$/;
const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".svelte-kit",
	"dist",
	"build",
	"__tests__",
	"fixtures",
]);

const ALLOWED_ROOT_PREFIXES = [
	"components/selector/",
	"components/dropdown-menu/",
];

const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
	{ pattern: /\bDropdownMenu\.Root\b/, label: "DropdownMenu.Root" },
	{ pattern: /\bDropdownMenu\.Trigger\b/, label: "DropdownMenu.Trigger" },
	{ pattern: /\bDropdownMenu\.Content\b/, label: "DropdownMenu.Content" },
];

interface Violation {
	filePath: string;
	label: string;
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

function isAllowedFile(relativePath: string): boolean {
	return ALLOWED_ROOT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function scanFile(absolutePath: string): Violation[] {
	const relativePath = relative(UI_PACKAGE_ROOT, absolutePath);
	if (isAllowedFile(relativePath)) {
		return [];
	}

	const source = readFileSync(absolutePath, "utf8");
	const violations: Violation[] = [];

	for (const { pattern, label } of FORBIDDEN_PATTERNS) {
		if (pattern.test(source)) {
			violations.push({ filePath: relativePath, label });
		}
	}

	return violations;
}

const violations: Violation[] = [];

for (const filePath of collectSourceFiles(UI_PACKAGE_ROOT)) {
	violations.push(...scanFile(filePath));
}

if (violations.length > 0) {
	console.error("DropdownMenu shell primitives must only live in selector/ and dropdown-menu/:");
	for (const violation of violations) {
		console.error(`- packages/ui/src/${violation.filePath}: ${violation.label}`);
	}
	process.exit(1);
}

console.log("DropdownMenu shell boundary check passed.");
