import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type PackageJson = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as PackageJson;
const dependencyBlocks = [
	packageJson.dependencies ?? {},
	packageJson.devDependencies ?? {},
	packageJson.peerDependencies ?? {},
	packageJson.optionalDependencies ?? {},
];

const hasTanStackVirtual = dependencyBlocks.some(
	(block) => block["@tanstack/svelte-virtual"] !== undefined
);
const forbiddenDeps = dependencyBlocks.flatMap((block) =>
	Object.keys(block).filter((name) => name === "virtua" || name.startsWith("@virtua/"))
);

if (!hasTanStackVirtual) {
	console.error("Transcript virtualization must depend on @tanstack/svelte-virtual.");
	process.exit(1);
}

if (forbiddenDeps.length > 0) {
	console.error(`Remove forbidden virtualizer dependency: ${forbiddenDeps.join(", ")}`);
	process.exit(1);
}

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
	console.error("Transcript virtualization must use TanStack Virtual, not virtua:");
	for (const filePath of violations) {
		console.error(`- ${relative(process.cwd(), filePath)}`);
	}
	process.exit(1);
}
