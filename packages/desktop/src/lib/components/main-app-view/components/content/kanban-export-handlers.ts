/**
 * Session export / open-in-external-tool handlers for the kanban view.
 *
 * Extracted verbatim from kanban-view.svelte. Each handler takes the board item
 * as an argument and delegates to the panel services; none write component
 * `$state`, so they live cleanly in a factory taking only the stores it needs.
 */

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
		await tauriClient.shell
			.getSessionFilePath(item.sessionId, item.projectPath)
			.andThen((path) => openFileInEditor(path))
			.match(
				() => toast.success("Opened streaming log in file manager"),
				(err) => toast.error(`Failed to open session file: ${err.message}`)
			);
	}

	async function handleOpenInAcepe(item: ThreadBoardItem): Promise<void> {
		await tauriClient.shell.getSessionFilePath(item.sessionId, item.projectPath).match(
			(fullPath) => {
				const parts = fullPath.split(/[/\\]/);
				const fileName = parts.pop() ?? fullPath;
				const dirPath = parts.join("/") || "/";
				deps.panelStore.openFilePanel(fileName, dirPath, { ownerPanelId: item.panelId });
			},
			(err) => toast.error(`Failed to open session file: ${err.message}`)
		);
	}

	async function handleExportMarkdown(item: ThreadBoardItem): Promise<void> {
		await deps.sessionStore
			.getSessionMarkdownExportContent(item.sessionId)
			.asyncAndThen((markdown) => {
				return copyTextToClipboard(markdown);
			})
			.match(
				() => toast.success("Copied to clipboard"),
				(error) => toast.error(`Failed to export: ${error.message}`)
			);
	}

	async function handleExportJson(item: ThreadBoardItem): Promise<void> {
		await deps.sessionStore
			.getSessionJsonExportContent(item.sessionId)
			.asyncAndThen((content) => {
				return copyTextToClipboard(content);
			})
			.match(
				() => toast.success("Copied to clipboard"),
				(error) => toast.error(`Failed to export: ${error.message}`)
			);
	}

	async function handleCopyStreamingLogPath(item: ThreadBoardItem): Promise<void> {
		await tauriClient.shell
			.getStreamingLogPath(item.sessionId)
			.andThen((path) => copyTextToClipboard(path))
			.match(
				() => toast.success("Path copied to clipboard"),
				() => toast.error("Failed to copy path")
			);
	}

	async function handleExportRawStreaming(item: ThreadBoardItem): Promise<void> {
		await tauriClient.shell.openStreamingLog(item.sessionId).match(
			() => undefined,
			(err) => toast.error(`Failed to open streaming log: ${err.message}`)
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
