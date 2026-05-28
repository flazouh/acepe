import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const productionRoot = join(process.cwd(), "src", "lib", "acp", "components", "agent-panel");
const forbiddenProductionFiles = [
	"logic/transcript-viewport-controller.ts",
	"logic/transcript-renderer-adapter.ts",
	"logic/transcript-viewport-scheduler.svelte.ts",
	"logic/transcript-viewport-row-summary.ts",
	"logic/transcript-viewport-effects.ts",
	"logic/transcript-viewport-events.ts",
	"logic/viewport-anchor.ts",
	"logic/transcript-viewport-diagnostics.ts",
	"logic/transcript-viewport-replay.ts",
];
const sourceExtensions = new Set([".ts", ".svelte"]);
const forbiddenImportPattern =
	/@tanstack\/svelte-virtual|transcript-viewport-controller|transcript-renderer-adapter|transcript-viewport-scheduler|transcript-viewport-row-summary|transcript-viewport-effects|transcript-viewport-events|viewport-anchor|transcript-viewport-diagnostics|transcript-viewport-replay/;
const providerIdentityRepairPattern = /message\.id|providerMsgId|provider_msg_id/;

function collectSourceFiles(root: string): string[] {
	if (!existsSync(root)) {
		return [];
	}
	const stats = statSync(root);
	if (stats.isFile()) {
		return sourceExtensions.has(root.slice(root.lastIndexOf("."))) ? [root] : [];
	}

	const files: string[] = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name === "__tests__") {
			continue;
		}
		files.push(...collectSourceFiles(join(root, entry.name)));
	}
	return files;
}

const existingForbiddenFiles = forbiddenProductionFiles
	.map((filePath) => join(productionRoot, filePath))
	.filter((filePath) => existsSync(filePath));

const scannedFiles = collectSourceFiles(productionRoot);
const forbiddenImports = scannedFiles.filter((filePath) =>
	forbiddenImportPattern.test(readFileSync(filePath, "utf8"))
);
const providerIdentityRepairs = scannedFiles.filter((filePath) =>
	providerIdentityRepairPattern.test(readFileSync(filePath, "utf8"))
);

if (
	existingForbiddenFiles.length > 0 ||
	forbiddenImports.length > 0 ||
	providerIdentityRepairs.length > 0
) {
	console.error("Main transcript viewport must be Rust-owned:");
	for (const filePath of existingForbiddenFiles) {
		console.error(`- delete old viewport authority file ${relative(process.cwd(), filePath)}`);
	}
	for (const filePath of forbiddenImports) {
		console.error(`- remove forbidden viewport authority import ${relative(process.cwd(), filePath)}`);
	}
	for (const filePath of providerIdentityRepairs) {
		console.error(`- remove provider-id display repair ${relative(process.cwd(), filePath)}`);
	}
	process.exit(1);
}
