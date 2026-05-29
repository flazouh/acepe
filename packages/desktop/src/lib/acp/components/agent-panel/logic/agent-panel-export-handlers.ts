/**
 * Session export / open-in-external-tool handlers for the agent panel controller.
 *
 * Extracted verbatim from agent-panel.svelte. These delegate to the panel
 * service helpers and read reactive scalars via accessor functions; none of
 * them write component-local `$state`.
 */

import { toast } from "svelte-sonner";
import type { PanelStore } from "../../../store/panel-store.svelte.js";
import type { SessionStore } from "../../../store/session-store.svelte.js";
import type { Logger } from "../../../utils/logger.js";
import {
	copyStreamingLogPathToClipboard,
	copyThreadContentToClipboard,
	exportSessionJsonToClipboard,
	exportSessionMarkdownToClipboard,
	openSessionFileInAcepePanel,
	openSessionInFinder,
	openSessionRawFileInEditor,
	openStreamingLog,
} from "../services/index.js";

export interface AgentPanelExportHandlerDeps {
	getSessionId: () => string | null;
	getSessionProjectPath: () => string | null;
	getSessionAgentId: () => string | null;
	getSessionSourcePath: () => string | null;
	getEffectivePanelId: () => string;
	sessionStore: SessionStore;
	panelStore: PanelStore;
	logger: Logger;
}

export function createAgentPanelExportHandlers(deps: AgentPanelExportHandlerDeps) {
	async function handleCopyContent() {
		const sessionId = deps.getSessionId();
		if (!sessionId) {
			toast.error("No thread to copy");
			return;
		}
		await copyThreadContentToClipboard({
			sessionId,
			getSessionJsonExportContent: (id) => deps.sessionStore.getSessionJsonExportContent(id),
		});
	}

	async function handleOpenInFinder() {
		await openSessionInFinder({
			sessionId: deps.getSessionId(),
			projectPath: deps.getSessionProjectPath(),
			agentId: deps.getSessionAgentId(),
			sourcePath: deps.getSessionSourcePath(),
		});
	}

	async function handleExportRawStreaming() {
		await openStreamingLog(deps.getSessionId());
	}

	async function handleCopyStreamingLogPath() {
		await copyStreamingLogPathToClipboard({ sessionId: deps.getSessionId(), logger: deps.logger });
	}

	async function handleOpenRawFile() {
		await openSessionRawFileInEditor({
			sessionId: deps.getSessionId(),
			sessionProjectPath: deps.getSessionProjectPath(),
		});
	}

	async function handleOpenInAcepe() {
		await openSessionFileInAcepePanel({
			sessionId: deps.getSessionId(),
			sessionProjectPath: deps.getSessionProjectPath(),
			effectivePanelId: deps.getEffectivePanelId(),
			openFilePanel: (fileName, dirPath, opts) =>
				deps.panelStore.openFilePanel(fileName, dirPath, opts),
		});
	}

	async function handleExportMarkdown(): Promise<void> {
		const sessionId = deps.getSessionId();
		if (!sessionId) return;
		await deps.sessionStore.getSessionMarkdownExportContent(sessionId).match(
			(markdown) => exportSessionMarkdownToClipboard(markdown),
			(error) => {
				toast.error(error.message);
			}
		);
	}

	async function handleExportJson() {
		const sessionId = deps.getSessionId();
		if (!sessionId) return;
		await exportSessionJsonToClipboard({
			sessionId,
			getSessionJsonExportContent: (id) => deps.sessionStore.getSessionJsonExportContent(id),
		});
	}

	return {
		handleCopyContent,
		handleOpenInFinder,
		handleExportRawStreaming,
		handleCopyStreamingLogPath,
		handleOpenRawFile,
		handleOpenInAcepe,
		handleExportMarkdown,
		handleExportJson,
	};
}
