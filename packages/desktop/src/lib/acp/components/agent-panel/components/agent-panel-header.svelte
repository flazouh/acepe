<script lang="ts">
import {
	AgentPanelHeader as AgentPanelHeaderLayout,
	AgentPanelStatusIcon,
} from "@acepe/ui/agent-panel";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import {
	CloseAction,
	FullscreenAction,
	OverflowMenuTriggerAction,
} from "@acepe/ui/panel-header";
import { DownloadSimple } from "phosphor-svelte";
import CopyButton from "../../messages/copy-button.svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";

import type { AgentPanelHeaderProps } from "../types/agent-panel-header-props.js";

const isDev = import.meta.env.DEV;

let {
	pendingProjectSelection,
	isConnecting,
	sessionId,
	sessionTitle,
	sessionAgentId,
	agentIconSrc,
	agentName: _agentName,
	isFullscreen,
	sessionStatus,
	projectName,
	projectColor,
	projectIconSrc,
	sequenceId,
	hideProjectBadge = false,
	onClose,
	onToggleFullscreen,
	onCopyStreamingLogPath,
	onExportRawStreaming,
	displayTitle = null,
	onExportMarkdown,
	onExportJson,
	onScrollToTop,
	// Debug props
	debugPanelState,
}: AgentPanelHeaderProps = $props();

const hasExportSubmenu = $derived(onExportMarkdown != null || onExportJson != null);
</script>

	<AgentPanelHeaderLayout
		class="bg-card/50"
		showTrailingBorder={!isFullscreen}
		sessionTitle={sessionTitle ? sessionTitle : undefined}
		displayTitle={displayTitle ? displayTitle : undefined}
		{agentIconSrc}
		{isFullscreen}
		{isConnecting}
		{pendingProjectSelection}
		projectName={hideProjectBadge ? undefined : projectName}
		projectColor={hideProjectBadge ? undefined : projectColor}
		projectIconSrc={hideProjectBadge ? undefined : projectIconSrc}
		sequenceId={hideProjectBadge ? undefined : sequenceId}
		{onClose}
		{onToggleFullscreen}
		{onScrollToTop}
	>
		{#snippet statusIndicator()}
			<!-- Status is shown via the controls snippet in the action cell -->
		{/snippet}

		{#snippet controls()}
			<AgentPanelStatusIcon
				status={sessionStatus}
				{isConnecting}
				agentId={sessionAgentId}
				warmingLabel={m.thread_status_preparing()}
				connectedLabel={m.thread_status_connected()}
				errorLabel={m.thread_status_error()}
			/>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					class="h-7 w-7 flex items-center justify-center focus-visible:outline-none"
				>
					<OverflowMenuTriggerAction title="More actions" />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-[180px]">
					<DropdownMenu.Item class="cursor-pointer">
						<CopyButton
							text={sessionId ?? ""}
							variant="menu"
							label={m.session_menu_copy_id()}
							hideIcon
							size={16}
						/>
					</DropdownMenu.Item>
					{#if hasExportSubmenu}
						<DropdownMenu.Separator />
						<DropdownMenu.Sub>
							<DropdownMenu.SubTrigger class="cursor-pointer">
								{m.session_menu_export()}
							</DropdownMenu.SubTrigger>
							<DropdownMenu.SubContent class="min-w-[160px]">
								{#if onExportMarkdown}
									<DropdownMenu.Item onSelect={() => onExportMarkdown?.()} class="cursor-pointer">
										{m.session_menu_export_markdown()}
									</DropdownMenu.Item>
								{/if}
								{#if onExportJson}
									<DropdownMenu.Item onSelect={() => onExportJson?.()} class="cursor-pointer">
										{m.session_menu_export_json()}
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.SubContent>
						</DropdownMenu.Sub>
					{/if}
					{#if isDev}
						<DropdownMenu.Separator />
						<DropdownMenu.Item onSelect={() => onCopyStreamingLogPath?.()} class="cursor-pointer">
							Copy Streaming Log Path
						</DropdownMenu.Item>
						<DropdownMenu.Item onSelect={() => onExportRawStreaming?.()} class="cursor-pointer">
							{m.thread_export_raw_streaming()}
						</DropdownMenu.Item>
					{/if}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			{#if isDev && debugPanelState}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<button
							type="button"
							class="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground rounded"
							onclick={async () => {
								const text = JSON.stringify(debugPanelState!, null, 2);
								await navigator.clipboard.writeText(text);
							}}
						>
							<DownloadSimple class="size-4" weight="fill" aria-label="Copy debug state" />
						</button>
					</Tooltip.Trigger>
					<Tooltip.Content side="bottom" class="max-w-none">
						<div class="max-h-96 overflow-auto">
							<pre class="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(
									debugPanelState,
									null,
									2
								)}</pre>
						</div>
						<div class="mt-2 text-xs text-muted-foreground border-t pt-1">Click to copy JSON</div>
					</Tooltip.Content>
				</Tooltip.Root>
			{/if}
			<FullscreenAction
				{isFullscreen}
				onToggle={onToggleFullscreen}
				titleEnter={m.panel_fullscreen()}
				titleExit={m.panel_exit_fullscreen()}
			/>
			<CloseAction {onClose} title={m.common_close()} />
		{/snippet}
	</AgentPanelHeaderLayout>
