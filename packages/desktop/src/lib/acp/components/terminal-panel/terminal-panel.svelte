<script lang="ts">
import { TerminalPanelLayout } from "@acepe/ui/terminal-panel";
import type { TerminalTab } from "$lib/acp/store/types.js";
import { shell as shellClient } from "$lib/utils/tauri-client/shell.js";

import TerminalPanelHeader from "./terminal-panel-header.svelte";
import TerminalRenderer from "./terminal-renderer.svelte";

interface Props {
	panelId: string;
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	width: number;
	isFullscreenEmbedded?: boolean;
	shell: string | null;
	hideProjectBadge?: boolean;
	onClose: () => void;
	onResize: (panelId: string, delta: number) => void;
	onPtyCreated: (ptyId: number, shell: string) => void;
	/** When true, this terminal is the aux panel in fullscreen (show exit fullscreen). */
	isAuxFullscreen?: boolean;
	onEnterFullscreen?: () => void;
	onExitFullscreen?: () => void;
	/** Tab support */
	tabs?: readonly TerminalTab[];
	selectedTabId?: string | null;
	onSelectTab?: (id: string) => void;
	onNewTab?: () => void;
	onCloseTab?: (id: string) => void;
	onMoveTabToNewPanel?: (id: string) => void;
	canMoveTabToNewPanel?: (id: string) => boolean;
}

let {
	panelId,
	projectPath,
	projectName,
	projectColor,
	width,
	isFullscreenEmbedded = false,
	shell,
	hideProjectBadge = false,
	onClose,
	onResize,
	onPtyCreated,
	isAuxFullscreen = false,
	onEnterFullscreen,
	onExitFullscreen,
	tabs,
	selectedTabId,
	onSelectTab,
	onNewTab,
	onCloseTab,
	onMoveTabToNewPanel,
	canMoveTabToNewPanel,
}: Props = $props();

const SHELL_ERROR_PREFIX = "Failed to load shell";
const PTY_ERROR_PREFIX = "Failed to start terminal";

// Resize state
let isDragging = $state(false);
let startX = $state(0);

// Shell detection state
let detectedShell = $state<string | null>(null);
let shellError = $state<string | null>(null);
let ptyError = $state<string | null>(null);

// Get default shell on mount
$effect(() => {
	if (!detectedShell && !shell) {
		shellClient.getDefaultShell().match(
			(s) => {
				detectedShell = s;
			},
			(e) => {
				shellError = String(e);
			}
		);
	}
});

const effectiveShell = $derived(shell ?? detectedShell);
const widthStyle = $derived(
	isFullscreenEmbedded
		? "min-width: 0;"
		: `min-width: ${width}px; width: ${width}px; max-width: ${width}px;`
);
const combinedError = $derived(
	shellError
		? `${SHELL_ERROR_PREFIX}: ${shellError}`
		: ptyError
			? `${PTY_ERROR_PREFIX}: ${ptyError}`
			: null
);

function handlePtyCreated(ptyId: number) {
	if (effectiveShell) {
		onPtyCreated(ptyId, effectiveShell);
	}
}

function handlePtyError(error: string) {
	ptyError = error;
}

function handlePointerDown(e: PointerEvent) {
	isDragging = true;
	startX = e.clientX;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!isDragging) return;
	const delta = e.clientX - startX;
	startX = e.clientX;
	onResize(panelId, delta);
}

function handlePointerUp() {
	isDragging = false;
}
</script>

<div
	class="flex flex-col h-full min-h-0 bg-card/50 border border-border rounded-lg overflow-hidden relative {isFullscreenEmbedded
		? 'flex-1 basis-0 min-w-0'
		: 'shrink-0 grow-0'} {isDragging ? 'select-none' : ''}"
	style={widthStyle}
>
	<TerminalPanelLayout
		{projectName}
		projectColor={projectColor ?? ""}
		shell={effectiveShell}
		{hideProjectBadge}
		loading={!effectiveShell && !combinedError}
		error={combinedError}
		{onClose}
	>
		{#snippet header()}
			<TerminalPanelHeader
				{projectName}
				{projectColor}
				shell={effectiveShell}
				{hideProjectBadge}
				{onClose}
				{isAuxFullscreen}
				{onEnterFullscreen}
				{onExitFullscreen}
				{tabs}
				{selectedTabId}
				{onSelectTab}
				{onNewTab}
				{onCloseTab}
				{onMoveTabToNewPanel}
				{canMoveTabToNewPanel}
			/>
		{/snippet}

		{#snippet terminalContent()}
			{#if effectiveShell}
				<TerminalRenderer
					{projectPath}
					shell={effectiveShell}
					onPtyCreated={handlePtyCreated}
					onPtyError={handlePtyError}
				/>
			{/if}
		{/snippet}
	</TerminalPanelLayout>

	{#if !isFullscreenEmbedded}
		<!-- Resize Edge -->
		<div
			class="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
			role="separator"
			aria-orientation="vertical"
			tabindex="-1"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		></div>
	{/if}
</div>
