import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const sourceRoot = join(process.cwd(), "src", "lib", "acp");
const sourceExtensions = new Set([".ts", ".svelte"]);
const forbiddenImportPattern =
	/(?:from\s+|import\s*)["'](?:virtua|@virtua\/[^"']+)["']|import\s*\(\s*["'](?:virtua|@virtua\/[^"']+)["']\s*\)/;

function collectSourceFiles(root: string): string[] {
	const stats = statSync(root);
	if (stats.isFile()) {
		return sourceExtensions.has(root.slice(root.lastIndexOf("."))) ? [root] : [];
	}

	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === ".svelte-kit") {
			continue;
		}
		files.push(...collectSourceFiles(join(root, entry.name)));
	}
	return files;
}

const violations = collectSourceFiles(sourceRoot).filter((filePath) =>
	forbiddenImportPattern.test(readFileSync(filePath, "utf8"))
);

if (violations.length > 0) {
	console.error("ACP source must not import forbidden browser virtualizer dependencies:");
	for (const filePath of violations) {
		console.error(`- ${relative(process.cwd(), filePath)}`);
	}
	process.exit(1);
}
