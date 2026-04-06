<script lang="ts">
	import type { Snippet } from "svelte";

	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import type { AgentSessionStatus } from "./types.js";
	import {
		CloseAction,
		EmbeddedPanelHeader,
		FullscreenAction,
		HeaderActionCell,
		HeaderCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";

	interface Props {
		sessionTitle?: string;
		displayTitle?: string;
		agentIconSrc?: string;
		sessionStatus?: AgentSessionStatus;
		isFullscreen?: boolean;
		isConnecting?: boolean;
		pendingProjectSelection?: boolean;
		projectName?: string;
		projectColor?: string;
		sequenceId?: number | null;
		onClose?: () => void;
		onToggleFullscreen?: () => void;
		onScrollToTop?: () => void;
		statusIndicator?: Snippet;
		dropdownMenu?: Snippet;
		trailingActions?: Snippet;
		controls?: Snippet;
		class?: string;
	}

	let {
		sessionTitle,
		displayTitle,
		agentIconSrc,
		sessionStatus = "empty",
		isFullscreen = false,
		isConnecting = false,
		pendingProjectSelection = false,
		projectName,
		projectColor,
		sequenceId,
		onClose,
		onToggleFullscreen,
		onScrollToTop,
		statusIndicator,
		dropdownMenu,
		trailingActions,
		controls,
		class: className = "",
	}: Props = $props();
</script>

<EmbeddedPanelHeader onHeaderClick={onScrollToTop} class={className}>
	{#if pendingProjectSelection}
		<HeaderTitleCell>
			{#snippet children()}
				<span class="text-[11px] font-medium truncate">Select a project</span>
			{/snippet}
		</HeaderTitleCell>
		<HeaderActionCell>
			{#snippet children()}
				<CloseAction onClose={onClose} />
			{/snippet}
		</HeaderActionCell>
	{:else}
		{#if projectName && projectColor}
			<HeaderCell withDivider={false}>
				<ProjectLetterBadge name={projectName} color={projectColor} size={14} class="shrink-0" />
				{#if sequenceId != null}
					<span class="font-mono text-[10px] text-muted-foreground/70">#{sequenceId}</span>
				{/if}
			</HeaderCell>
		{/if}
		{#if agentIconSrc}
			<HeaderCell>
				<img src={agentIconSrc} alt="" class="w-3.5 h-3.5" role="presentation" />
			</HeaderCell>
		{/if}
		<HeaderTitleCell hoverable={Boolean(onScrollToTop)}>
			{#snippet children()}
				<div class="flex items-center gap-1.5 min-w-0">
					<span class="text-[11px] font-medium truncate"
						>{displayTitle ? displayTitle : sessionTitle ? sessionTitle : "New thread"}</span
					>

					{#if statusIndicator}
						{@render statusIndicator()}
					{:else if isConnecting || sessionStatus === "warming"}
						<span class="relative flex h-2 w-2 shrink-0">
							<span
								class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-muted-foreground"
							></span>
							<span class="relative inline-flex rounded-full h-2 w-2 bg-muted-foreground"></span>
						</span>
					{:else if sessionStatus === "connected"}
						<span class="h-2 w-2 rounded-full shrink-0 bg-success"></span>
					{:else if sessionStatus === "error"}
						<span class="h-2 w-2 rounded-full shrink-0 bg-destructive"></span>
					{/if}
				</div>
			{/snippet}
		</HeaderTitleCell>

		<HeaderActionCell withDivider={true} class="divide-x divide-border/50">
			{#snippet children()}
				{#if controls}
					{@render controls()}
				{:else}
					{#if dropdownMenu}
						{@render dropdownMenu()}
					{/if}
					{#if trailingActions}
						{@render trailingActions()}
					{/if}
					{#if onToggleFullscreen}
						<FullscreenAction isFullscreen={isFullscreen} onToggle={onToggleFullscreen} />
					{/if}
					<CloseAction onClose={onClose} />
				{/if}
			{/snippet}
		</HeaderActionCell>
	{/if}
</EmbeddedPanelHeader>
