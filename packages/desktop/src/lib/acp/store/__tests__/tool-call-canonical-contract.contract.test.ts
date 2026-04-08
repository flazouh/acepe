import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

function read(relativePath: string): string {
	return readFileSync(resolve(import.meta.dir, relativePath), "utf8");
}

describe("tool call canonical contract", () => {
	it("routes downstream presentation policy through the shared Rust helper", () => {
		const helperSource = read("../../../../../src-tauri/src/acp/tool_call_presentation.rs");
		const cursorLiveSource = read(
			"../../../../../src-tauri/src/acp/providers/cursor_session_update_enrichment.rs"
		);
		const codexLiveSource = read(
			"../../../../../src-tauri/src/acp/client/codex_native_events.rs"
		);
		const cursorReplaySource = read("../../../../../src-tauri/src/session_converter/cursor.rs");
		const reconcilerSource = read("../../../../../src-tauri/src/acp/task_reconciler.rs");

		expect(helperSource).toContain("pub(crate) fn title_is_placeholder");
		expect(helperSource).toContain("pub(crate) fn synthesize_title");
		expect(helperSource).toContain("pub(crate) fn synthesize_locations");
		expect(helperSource).toContain("pub(crate) fn merge_tool_arguments");

		expect(cursorLiveSource).toContain("use crate::acp::tool_call_presentation::{");
		expect(cursorLiveSource).toContain("title_is_placeholder");
		expect(cursorLiveSource).toContain("synthesize_title");
		expect(cursorLiveSource).toContain("synthesize_locations");

		expect(codexLiveSource).toContain("use crate::acp::tool_call_presentation::{");
		expect(codexLiveSource).toContain("synthesize_title");
		expect(codexLiveSource).toContain("synthesize_locations");

		expect(cursorReplaySource).toContain("use crate::acp::tool_call_presentation::{");
		expect(cursorReplaySource).toContain("merge_tool_arguments");
		expect(cursorReplaySource).toContain("title_is_placeholder");

		expect(reconcilerSource).toContain("merge_canonical_tool_arguments");
		expect(reconcilerSource).not.toContain("fn merge_edit_entries(");
	});

	it("keeps the generic frontend consumer fail-closed instead of synthesizing titles or locations", () => {
		const managerSource = read("../services/tool-call-manager.svelte.ts");

		expect(managerSource).toContain("title: update.title ?? toolCall.title,");
		expect(managerSource).toContain("locations: update.locations ?? toolCall.locations,");

		expect(managerSource).not.toContain("function extractPathFromToolArguments(");
		expect(managerSource).not.toContain("function extractPathFromLocations(");
		expect(managerSource).not.toContain("function isGenericPathTitle(");
		expect(managerSource).not.toContain("function synthesizeEditTitle(");
		expect(managerSource).not.toContain("function synthesizeToolTitle(");
		expect(managerSource).not.toContain("`Read ${path}`");
		expect(managerSource).not.toContain("`Edit ${path}`");
		expect(managerSource).not.toContain("`Delete ${path}`");
		expect(managerSource).not.toContain("`Rename ${moveFrom} -> ${path}`");
	});

	it("keeps canonical interaction ownership on reply handlers instead of transport-id ordering", () => {
		const permissionStoreSource = read("../permission-store.svelte.ts");
		const interactionStoreSource = read("../interaction-store.svelte.ts");

		expect(permissionStoreSource).not.toContain("candidateRequestId > currentRequestId");
		expect(permissionStoreSource).not.toContain("jsonRpcRequestId >");

		expect(interactionStoreSource).toContain(
			"normalizeInteractionReplyHandler(interaction.reply_handler) ??"
		);
		expect(interactionStoreSource).not.toContain(
			"jsonRpcRequestId === null || tool === undefined || status === null"
		);
	});
});
