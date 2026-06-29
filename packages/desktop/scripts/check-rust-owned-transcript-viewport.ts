import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const acpRoot = join(process.cwd(), "src", "lib", "acp");
const productionRoot = join(acpRoot, "components", "agent-panel");
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
	"logic/transcript-viewport-webview-adapter.svelte.ts",
	"logic/transcript-viewport-scroll-controller.ts",
	"logic/transcript-viewport-height-confirm.ts",
	"logic/transcript-viewport-flight-recorder.ts",
];
const sourceExtensions = new Set([".ts", ".svelte"]);
const forbiddenImportPattern =
	/@tanstack\/svelte-virtual|transcript-viewport-controller|transcript-renderer-adapter|transcript-viewport-scheduler|transcript-viewport-row-summary|transcript-viewport-effects|transcript-viewport-events|viewport-anchor|transcript-viewport-diagnostics|transcript-viewport-replay|transcript-viewport-webview-adapter|transcript-viewport-scroll-controller|transcript-viewport-height-confirm|transcript-viewport-flight-recorder/;
const providerIdentityRepairPattern = /message\.id|providerMsgId|provider_msg_id/;
const forbiddenPixelWirePattern =
	/\b(ViewportMode|ViewportWindow|ViewportClientScrollState|getBufferProjection|BufferProjection|viewportRevision|layoutRowCount|totalHeightPx|bufferEndOffsetPx|offsetsPx|scrollTopTarget|scrollAnchorCorrectionPx|fromViewportRevision|toViewportRevision|prependedOffsetsPx|appendedOffsetsPx|confirmTranscriptViewportHeight|scrollTranscriptViewport|revealTranscriptViewportRow|resizeTranscriptViewport)\b/;

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

const productionFiles = collectSourceFiles(productionRoot);
const acpFiles = collectSourceFiles(acpRoot);
const forbiddenImports = productionFiles.filter((filePath) =>
	forbiddenImportPattern.test(readFileSync(filePath, "utf8"))
);
const providerIdentityRepairs = productionFiles.filter((filePath) =>
	providerIdentityRepairPattern.test(readFileSync(filePath, "utf8"))
);
const forbiddenPixelWire = acpFiles.filter((filePath) =>
	forbiddenPixelWirePattern.test(readFileSync(filePath, "utf8"))
);

if (
	existingForbiddenFiles.length > 0 ||
	forbiddenImports.length > 0 ||
	providerIdentityRepairs.length > 0 ||
	forbiddenPixelWire.length > 0
) {
	console.error("Transcript viewport wire must be rows-only and DOM-authority:");
	for (const filePath of existingForbiddenFiles) {
		console.error(`- delete old viewport authority file ${relative(process.cwd(), filePath)}`);
	}
	for (const filePath of forbiddenImports) {
		console.error(`- remove forbidden viewport authority import ${relative(process.cwd(), filePath)}`);
	}
	for (const filePath of providerIdentityRepairs) {
		console.error(`- remove provider-id display repair ${relative(process.cwd(), filePath)}`);
	}
	for (const filePath of forbiddenPixelWire) {
		console.error(`- remove old pixel viewport wire ${relative(process.cwd(), filePath)}`);
	}
	process.exit(1);
}
