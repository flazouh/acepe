<script lang="ts">
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { NativeMarkdown } from "@acepe/ui/native-markdown";
	import type { TogglePrLinkPayload } from "@acepe/ui/native-markdown";

	import { useSessionContext } from "../../hooks/use-session-context.js";
	import { getPanelStore, type OpenProjectFileSystemDialogOptions } from "../../store/index.js";
	import { getSessionStore } from "../../store/session-store.svelte.js";
	import { createLogger } from "../../utils/logger.js";
	import { resolveProjectFileReference } from "./logic/file-chip-diff-enhancer.js";

	interface Props {
		text: string;
		/** Whether content is currently streaming */
		isStreaming?: boolean;
		projectPath?: string;
	}

	const logger = createLogger({ id: "markdown-text", name: "Markdown Text" });
	const sessionContext = useSessionContext();
	const panelStore = getPanelStore();
	const sessionStore = getSessionStore();

	let {
		text,
		isStreaming = false,
		projectPath: propProjectPath,
	}: Props = $props();

	const projectPath = $derived(propProjectPath);
	const nativeMarkdownMode = $derived(isStreaming ? "streaming" : "static");

	const sessionId = $derived(sessionContext?.sessionId);
	const linkProjectPath = $derived(sessionContext?.projectPath ?? propProjectPath);
	const linkedPrNumber = $derived(
		sessionId !== undefined ? (sessionStore.getSessionCold(sessionId)?.prNumber ?? null) : null
	);
	// Only expose the chip link/unlink control when we have a session + project to write to.
	const togglePrLink = $derived(
		sessionId !== undefined && linkProjectPath !== undefined
			? (payload: TogglePrLinkPayload) => handleTogglePrLink(sessionId, linkProjectPath, payload)
			: undefined
	);

	function handleTogglePrLink(
		targetSessionId: string,
		targetProjectPath: string,
		payload: TogglePrLinkPayload
	) {
		// Chip link/unlink is always a manual decision (mode "manual"), so it locks the
		// link and is never overridden by automatic create/open signals. Unlinking pins
		// "no PR" rather than re-enabling automatic linking.
		const nextPrNumber = payload.isLinked ? null : payload.prNumber;
		void sessionStore.connection
			.updateSessionPrLink(targetSessionId, targetProjectPath, nextPrNumber, "manual")
			.mapErr((error) => {
				logger.warn("Failed to toggle PR link from markdown chip", {
					sessionId: targetSessionId,
					prNumber: payload.prNumber,
					isLinked: payload.isLinked,
					error,
				});
				return error;
			});
	}

	function openExternalLink(url: string) {
		void openUrl(url);
	}

	function openFilePath(filePath: string) {
		if (projectPath === undefined) {
			logger.warn("Cannot open markdown file chip without project path", { filePath });
			return;
		}

		const fileReference = resolveProjectFileReference(filePath, projectPath);
		const dialogOptions: OpenProjectFileSystemDialogOptions = {};
		if (fileReference.targetLine !== undefined) {
			dialogOptions.targetLine = fileReference.targetLine;
		}
		if (fileReference.targetColumn !== undefined) {
			dialogOptions.targetColumn = fileReference.targetColumn;
		}
		panelStore.openProjectFileSystemDialog(projectPath, fileReference.filePath, dialogOptions);
	}
</script>

<NativeMarkdown
	markdown={text}
	mode={nativeMarkdownMode}
	parseIncompleteMarkdown={isStreaming}
	class="text-sm text-foreground"
	onExternalLinkClick={openExternalLink}
	onFilePathClick={openFilePath}
	{linkedPrNumber}
	onTogglePrLink={togglePrLink}
/>
