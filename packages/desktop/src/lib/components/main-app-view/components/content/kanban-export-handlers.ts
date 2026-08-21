/**
 * Session export / open-in-external-tool handlers for the kanban view.
 *
 * Extracted verbatim from kanban-view.svelte. Each handler takes the board item
 * as an argument and delegates to the panel services; none write component
 * `$state`, so they live cleanly in a factory taking only the stores it needs.
 */

import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { toast } from "svelte-sonner";
import { copyTextToClipboard } from "$lib/acp/components/agent-panel/logic/clipboard-manager.js";
import type { PanelStore } from "$lib/acp/store/panel-store.svelte.js";
import type { SessionStore } from "$lib/acp/store/session-store.svelte.js";
import type { ThreadBoardItem } from "$lib/acp/store/thread-board/thread-board-item.js";
import { openFileInEditor, tauriClient } from "$lib/utils/tauri-client.js";

export interface KanbanExportHandlerDeps {
	sessionStore: SessionStore;
	panelStore: PanelStore;
}

export function createKanbanExportHandlers(deps: KanbanExportHandlerDeps) {
	async function handleOpenRawFile(item: ThreadBoardItem): Promise<void> {
		await Effect.runPromise(
			tauriClient.shell.getSessionFilePath(item.sessionId, item.projectPath).pipe(
				Effect.flatMap((path) => openFileInEditor(path)),
				Effect.match({
					onSuccess: () => toast.success("Opened streaming log in file manager"),
					onFailure: (err) => toast.error(`Failed to open session file: ${err.message}`),
				})
			)
		);
	}

	async function handleOpenInAcepe(item: ThreadBoardItem): Promise<void> {
		await Effect.runPromise(
			tauriClient.shell.getSessionFilePath(item.sessionId, item.projectPath).pipe(
				Effect.match({
					onSuccess: (fullPath) => {
						const parts = fullPath.split(/[/\\]/);
						const fileName = parts.pop() ?? fullPath;
						const dirPath = parts.join("/") || "/";
						deps.panelStore.openFilePanel(fileName, dirPath, { ownerPanelId: item.panelId });
					},
					onFailure: (err) => toast.error(`Failed to open session file: ${err.message}`),
				})
			)
		);
	}

	async function handleExportMarkdown(item: ThreadBoardItem): Promise<void> {
		const exportResult = deps.sessionStore.read.getSessionMarkdownExportContent(item.sessionId);
		if (Result.isFailure(exportResult)) {
			toast.error(`Failed to export: ${exportResult.failure.message}`);
			return;
		}
		await Effect.runPromise(
			copyTextToClipboard(exportResult.success).pipe(
				Effect.match({
					onSuccess: () => toast.success("Copied to clipboard"),
					onFailure: (error) => toast.error(`Failed to export: ${error.message}`),
				})
			)
		);
	}

	async function handleExportJson(item: ThreadBoardItem): Promise<void> {
		const exportResult = deps.sessionStore.read.getSessionJsonExportContent(item.sessionId);
		if (Result.isFailure(exportResult)) {
			toast.error(`Failed to export: ${exportResult.failure.message}`);
			return;
		}
		await Effect.runPromise(
			copyTextToClipboard(exportResult.success).pipe(
				Effect.match({
					onSuccess: () => toast.success("Copied to clipboard"),
					onFailure: (error) => toast.error(`Failed to export: ${error.message}`),
				})
			)
		);
	}

	async function handleCopyStreamingLogPath(item: ThreadBoardItem): Promise<void> {
		await Effect.runPromise(
			tauriClient.shell.getStreamingLogPath(item.sessionId).pipe(
				Effect.flatMap((path) => copyTextToClipboard(path)),
				Effect.match({
					onSuccess: () => toast.success("Path copied to clipboard"),
					onFailure: () => toast.error("Failed to copy path"),
				})
			)
		);
	}

	async function handleExportRawStreaming(item: ThreadBoardItem): Promise<void> {
		await Effect.runPromise(
			tauriClient.shell.openStreamingLog(item.sessionId).pipe(
				Effect.match({
					onSuccess: () => undefined,
					onFailure: (err) => toast.error(`Failed to open streaming log: ${err.message}`),
				})
			)
		);
	}

	return {
		handleOpenRawFile,
		handleOpenInAcepe,
		handleExportMarkdown,
		handleExportJson,
		handleCopyStreamingLogPath,
		handleExportRawStreaming,
	};
}
