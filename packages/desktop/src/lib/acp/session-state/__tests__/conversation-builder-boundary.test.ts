import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_SRC = fileURLToPath(new URL("../../../../", import.meta.url));

const PATCH_CONVERSATION_MODULE_SUFFIXES = [
	"transcript-patch-conversations.ts",
	"interaction-patch-conversations.ts",
	"operation-patch-conversations.ts",
] as const;

const DISPATCHER_IMPORTER_SUFFIX = "lib/acp/session-state/conversation-dispatcher.ts";

const DISPATCHER_FACING_BUILDERS = [
	"materializeTranscriptArrayPatchedConversation",
	"materializeStreamingStatePatchedConversation",
	"materializeTranscriptPatchedConversation",
	"materializeTranscriptPatchedAndAppendedConversation",
	"materializeTranscriptAppendedConversation",
	"materializeTranscriptTruncatedConversation",
	"materializeInteractionPatchedConversation",
	"materializeBlockingInteractionRetargetConversation",
	"materializeOperationPatchedConversation",
] as const;

const INTERNAL_ONLY_BUILDERS = [
	"materializeStableInteractionPatchedConversation",
	"materializeStableInteractionAppendedConversation",
	"materializeStableInteractionTruncatedConversation",
	"materializeMarkedInteractionPatchedConversation",
	"materializeBlockingInteractionActivityChange",
] as const;

const SOURCE_FILE_PATTERN = /\.(?:ts|svelte)$/;
const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".svelte-kit",
	"dist",
	"build",
	"__tests__",
	"fixtures",
]);

interface BuilderImportViolation {
	readonly filePath: string;
	readonly builderName: string;
	readonly specifier: string;
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

function scanFile(filePath: string): BuilderImportViolation[] {
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

function relativeDesktopPath(filePath: string): string {
	return relative(DESKTOP_SRC, filePath).replaceAll("\\", "/");
}

describe("conversation builder import surface", () => {
	it("allows only the dispatcher to import dispatcher-facing patch builders", () => {
		const violations = collectSourceFiles(DESKTOP_SRC).flatMap((filePath) => {
			const relativePath = relativeDesktopPath(filePath);
			if (relativePath.endsWith("conversation-builder-boundary.test.ts")) {
				return [];
			}

			return scanFile(filePath).filter((violation) => {
				const importerPath = relativeDesktopPath(violation.filePath);
				return importerPath !== DISPATCHER_IMPORTER_SUFFIX;
			});
		});

		expect(violations).toEqual([]);
	});

	it("keeps interaction and operation sub-builders module-private", () => {
		const exportedInternalBuilders: string[] = [];

		for (const suffix of [
			"lib/acp/session-state/interaction-patch-conversations.ts",
			"lib/acp/session-state/operation-patch-conversations.ts",
		]) {
			const source = readFileSync(join(DESKTOP_SRC, suffix), "utf8");
			for (const builderName of INTERNAL_ONLY_BUILDERS) {
				if (new RegExp(`export function ${builderName}\\b`).test(source)) {
					exportedInternalBuilders.push(`${suffix}: ${builderName}`);
				}
			}
		}

		expect(exportedInternalBuilders).toEqual([]);
	});

	it("documents the dispatcher-facing builder set", () => {
		expect(DISPATCHER_FACING_BUILDERS).toHaveLength(9);
		expect(INTERNAL_ONLY_BUILDERS).toHaveLength(5);
		expect(DISPATCHER_FACING_BUILDERS.length + INTERNAL_ONLY_BUILDERS.length).toBe(14);
	});
});
