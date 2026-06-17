import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DESKTOP_SRC = join(import.meta.dir, "../packages/desktop/src");
const SOURCE_FILE_PATTERN = /\.(?:ts|svelte)$/;
const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".svelte-kit",
	"dist",
	"build",
	"__tests__",
	"fixtures",
]);

const PATCH_CONVERSATION_MODULE_SUFFIXES = [
	"transcript-patch-conversations.ts",
	"interaction-patch-conversations.ts",
	"operation-patch-conversations.ts",
] as const;

const DISPATCHER_IMPORTER_SUFFIX = "lib/acp/session-state/conversation-dispatcher.ts";

const INTERNAL_ONLY_BUILDERS = [
	"materializeStableInteractionPatchedConversation",
	"materializeStableInteractionAppendedConversation",
	"materializeStableInteractionTruncatedConversation",
	"materializeMarkedInteractionPatchedConversation",
	"materializeBlockingInteractionActivityChange",
] as const;

interface BuilderImportViolation {
	readonly filePath: string;
	readonly builderName: string;
	readonly specifier: string;
}

interface ExportedInternalBuilderViolation {
	readonly filePath: string;
	readonly builderName: string;
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

function extractImportBlocks(source: string): string[] {
	const blocks: string[] = [];
	const importPattern = /\bimport\s+(?:type\s+)?\{[\s\S]*?\}\s*from\s*["'][^"']+["']/g;
	let match = importPattern.exec(source);
	while (match !== null) {
		blocks.push(match[0]);
		match = importPattern.exec(source);
	}
	return blocks;
}

function importsPatchConversationModule(specifier: string): boolean {
	return PATCH_CONVERSATION_MODULE_SUFFIXES.some((suffix) => specifier.includes(suffix));
}

function extractImportedBuilderNames(importBlock: string): string[] {
	const names: string[] = [];
	const builderPattern = /\bmaterialize\w*Conversation\b/g;
	let match = builderPattern.exec(importBlock);
	while (match !== null) {
		names.push(match[0]);
		match = builderPattern.exec(importBlock);
	}
	return names;
}

function scanPatchBuilderImports(filePath: string): BuilderImportViolation[] {
	const rawSource = readFileSync(filePath, "utf8");
	const source = stripLineComments(stripBlockComments(rawSource));
	const violations: BuilderImportViolation[] = [];

	for (const importBlock of extractImportBlocks(source)) {
		const specifierMatch = /from\s*["']([^"']+)["']/.exec(importBlock);
		const specifier = specifierMatch?.[1];
		if (specifier === undefined || !importsPatchConversationModule(specifier)) {
			continue;
		}

		for (const builderName of extractImportedBuilderNames(importBlock)) {
			violations.push({
				filePath,
				builderName,
				specifier,
			});
		}
	}

	return violations;
}

function scanExportedInternalBuilders(filePath: string): ExportedInternalBuilderViolation[] {
	const source = readFileSync(filePath, "utf8");
	const violations: ExportedInternalBuilderViolation[] = [];

	for (const builderName of INTERNAL_ONLY_BUILDERS) {
		if (new RegExp(`export function ${builderName}\\b`).test(source)) {
			violations.push({
				filePath,
				builderName,
			});
		}
	}

	return violations;
}

function relativeDesktopPath(filePath: string): string {
	return relative(DESKTOP_SRC, filePath).replaceAll("\\", "/");
}

const patchBuilderViolations = collectSourceFiles(DESKTOP_SRC).flatMap((filePath) => {
	const relativePath = relativeDesktopPath(filePath);
	if (relativePath === DISPATCHER_IMPORTER_SUFFIX) {
		return [];
	}

	return scanPatchBuilderImports(filePath);
});

const exportedInternalBuilderViolations = [
	"lib/acp/session-state/interaction-patch-conversations.ts",
	"lib/acp/session-state/operation-patch-conversations.ts",
].flatMap((suffix) => scanExportedInternalBuilders(join(DESKTOP_SRC, suffix)));

let failed = false;

if (patchBuilderViolations.length > 0) {
	failed = true;
	console.error("Only conversation-dispatcher.ts may import patch conversation builders:");
	for (const violation of patchBuilderViolations) {
		console.error(
			`- ${relativeDesktopPath(violation.filePath)} imports ${violation.builderName} from ${violation.specifier}`
		);
	}
}

if (exportedInternalBuilderViolations.length > 0) {
	failed = true;
	console.error("Interaction/operation sub-builders must stay module-private:");
	for (const violation of exportedInternalBuilderViolations) {
		console.error(
			`- ${relativeDesktopPath(violation.filePath)} exports ${violation.builderName}`
		);
	}
}

if (failed) {
	process.exit(1);
}

console.log("No conversation-builder import boundary violations found.");
