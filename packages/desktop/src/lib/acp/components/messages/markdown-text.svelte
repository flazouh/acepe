<script lang="ts">
	import { openUrl } from "@tauri-apps/plugin-opener";
	import type { TokenRevealCss } from "@acepe/ui/agent-panel";
	import { StreamdownMarkdown } from "@acepe/ui/streamdown-markdown";
	import type { TogglePrLinkPayload } from "@acepe/ui/streamdown-markdown";

	import { useSessionContext } from "../../hooks/use-session-context.js";
	import { getPanelStore } from "../../store/index.js";
	import { getSessionStore } from "../../store/session-store.svelte.js";
	import { createLogger } from "../../utils/logger.js";
	import {
		DEFAULT_STREAMING_ANIMATION_MODE,
		type StreamingAnimationMode,
	} from "../../types/streaming-animation-mode.js";
	import { resolveProjectFileReference } from "./logic/file-chip-diff-enhancer.js";

	interface Props {
		text: string;
		/** Whether content is currently streaming */
		isStreaming?: boolean;
		tokenRevealCss?: TokenRevealCss;
		projectPath?: string;
		streamingAnimationMode?: StreamingAnimationMode;
	}

	const logger = createLogger({ id: "markdown-text", name: "Markdown Text" });
	const sessionContext = useSessionContext();
	const ownerPanelId = $derived(sessionContext?.panelId);
	const panelStore = getPanelStore();
	const sessionStore = getSessionStore();

	let {
		text,
		isStreaming = false,
		tokenRevealCss,
		projectPath: propProjectPath,
		streamingAnimationMode = DEFAULT_STREAMING_ANIMATION_MODE,
	}: Props = $props();

	const projectPath = $derived(propProjectPath);
	const streamdownMode = $derived(isStreaming ? "streaming" : "static");
	const streamdownAnimation = $derived(
		streamingAnimationMode === "smooth" ? undefined : false
	);

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
		panelStore.openFilePanel(fileReference.filePath, projectPath, {
			ownerPanelId,
			...(fileReference.targetLine !== undefined ? { targetLine: fileReference.targetLine } : {}),
			...(fileReference.targetColumn !== undefined
				? { targetColumn: fileReference.targetColumn }
				: {}),
		});
	}
</script>

<StreamdownMarkdown
	markdown={text}
	mode={streamdownMode}
	parseIncompleteMarkdown={isStreaming}
	animated={streamdownAnimation}
	tokenRevealTiming={tokenRevealCss}
	class="text-sm text-foreground"
	onExternalLinkClick={openExternalLink}
	onFilePathClick={openFilePath}
	{linkedPrNumber}
	onTogglePrLink={togglePrLink}
/>
