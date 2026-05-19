<script lang="ts">
	import { openUrl } from "@tauri-apps/plugin-opener";
	import type { TokenRevealCss } from "@acepe/ui/agent-panel";
	import { StreamdownMarkdown } from "@acepe/ui/streamdown-markdown";

	import { useSessionContext } from "../../hooks/use-session-context.js";
	import { getPanelStore } from "../../store/index.js";
	import { createLogger } from "../../utils/logger.js";
	import {
		DEFAULT_STREAMING_ANIMATION_MODE,
		type StreamingAnimationMode,
	} from "../../types/streaming-animation-mode.js";
	import { normalizeToProjectRelativePath } from "./logic/file-chip-diff-enhancer.js";

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

	function openExternalLink(url: string) {
		void openUrl(url);
	}

	function openFilePath(filePath: string) {
		if (projectPath === undefined) {
			logger.warn("Cannot open markdown file chip without project path", { filePath });
			return;
		}

		const relativePath = normalizeToProjectRelativePath(filePath, projectPath);
		panelStore.openFilePanel(relativePath, projectPath, { ownerPanelId });
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
/>
