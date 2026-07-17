<script lang="ts">
	import { openUrl } from "@tauri-apps/plugin-opener";
	import { reducedMotion } from "@acepe/ui";
	import { NativeMarkdown } from "@acepe/ui/native-markdown";
	import type { TogglePrLinkPayload } from "@acepe/ui/native-markdown";
	import {
		createRevealController,
		type RevealController,
		type RevealState,
	} from "@acepe/ui/streaming-reveal";

	import { useSessionContext } from "../../hooks/use-session-context.js";
	import { getChatPreferencesStore } from "../../store/chat-preferences-store.svelte.js";
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
	const chatPrefs = getChatPreferencesStore();

	let {
		text,
		isStreaming = false,
		projectPath: propProjectPath,
	}: Props = $props();

	const projectPath = $derived(propProjectPath);
	const nativeMarkdownMode = $derived(isStreaming ? "streaming" : "static");

	// --- Streaming reveal ------------------------------------------------------
	// The chosen mode drives a presentation buffer that smooths bursty model
	// output into a steady drip. This is DISPLAY-ONLY: the controller mirrors the
	// canonical `text` via setTarget and its visibleText never flows back upward.
	const revealMode = $derived(chatPrefs?.streamingRevealMode ?? "buffer");

	// Only text that actually streams live in this session animates. A completed
	// or replayed message mounts with isStreaming already false, so it renders raw
	// (no controller) — this also excludes the non-transcript MarkdownText uses
	// (plan dialog, file panel) which never stream.
	let hasStreamed = $state(false);
	$effect(() => {
		if (isStreaming) hasStreamed = true;
	});
	const revealActive = $derived(hasStreamed && revealMode !== "instant");

	let revealState = $state<RevealState | null>(null);
	let controller = $state<RevealController | null>(null);

	// Controller lives for this streamed block. Recreated if the mode changes
	// mid-stream. reducedMotion is captured here (and the CSS reveal honours it
	// too, so it's covered both ways).
	$effect(() => {
		if (!revealActive) {
			controller = null;
			revealState = null;
			return;
		}
		const created = createRevealController({
			mode: revealMode,
			reducedMotion: reducedMotion.current,
			onUpdate: (next) => {
				revealState = next;
			},
		});
		created.setTarget(text);
		controller = created;
		// Tab hidden pauses rAF; flush so nothing is stranded mid-drip on return.
		const onVisibility = () => {
			if (document.hidden) created.flush();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			created.destroy();
			if (controller === created) {
				controller = null;
				revealState = null;
			}
		};
	});

	// Mirror the growing canonical text into the controller.
	$effect(() => {
		const current = controller;
		if (current) current.setTarget(text);
	});

	// When streaming stops, drain the remaining buffer so the reveal finishes
	// smoothly instead of snapping to the full text.
	$effect(() => {
		if (!isStreaming) controller?.end();
	});

	const revealProp = $derived<"none" | "word" | "block">(
		!revealActive
			? "none"
			: revealMode === "buffer-fade"
				? "word"
				: revealMode === "block-fade"
					? "block"
					: "none"
	);

	const markdownSource = $derived.by(() => {
		if (!revealActive) return text;
		// Fall back to the full text (never blank) until the controller emits.
		const visible = revealState?.visibleText;
		if (visible === undefined) return text;
		// block-fade reveals whole blocks: while streaming, show only the
		// completed-block prefix so a half-typed block stays hidden until it ends.
		if (revealMode === "block-fade" && isStreaming) {
			const boundary = visible.lastIndexOf("\n\n");
			return boundary === -1 ? "" : visible.slice(0, boundary);
		}
		return visible;
	});

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
	markdown={markdownSource}
	mode={nativeMarkdownMode}
	parseIncompleteMarkdown={isStreaming}
	reveal={revealProp}
	class="text-sm text-foreground"
	onExternalLinkClick={openExternalLink}
	onFilePathClick={openFilePath}
	{linkedPrNumber}
	onTogglePrLink={togglePrLink}
/>
