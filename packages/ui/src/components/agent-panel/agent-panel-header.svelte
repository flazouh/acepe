<script lang="ts">
	import type { Snippet } from "svelte";

	import { Button } from "../button/index.js";
	import {
		CloseAction,
		EmbeddedPanelHeader,
		FullscreenAction,
		HeaderActionCell,
		HeaderCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import type {
		AgentPanelActionCallbacks,
		AgentPanelActionDescriptor,
		AgentPanelBadge,
		AgentSessionStatus,
	} from "./types.js";

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
		projectIconSrc?: string | null;
		sequenceId?: number | null;
		onClose?: () => void;
		onToggleFullscreen?: () => void;
		onScrollToTop?: () => void;
		statusIndicator?: Snippet;
		dropdownMenu?: Snippet;
		trailingActions?: Snippet;
		controls?: Snippet;
		subtitle?: string;
		agentLabel?: string | null;
		branchLabel?: string | null;
		badges?: readonly AgentPanelBadge[];
		actionButtons?: readonly AgentPanelActionDescriptor[];
		actionCallbacks?: AgentPanelActionCallbacks;
		showTrailingBorder?: boolean;
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
		projectIconSrc,
		sequenceId,
		onClose,
		onToggleFullscreen,
		onScrollToTop,
		statusIndicator,
		dropdownMenu,
		trailingActions,
		controls,
		subtitle,
		agentLabel,
		branchLabel,
		badges = [],
		actionButtons = [],
		actionCallbacks = {},
		showTrailingBorder = false,
		class: className = "",
	}: Props = $props();

	const visibleActionButtons = $derived((actionButtons ?? []).filter((action) => action.state !== "hidden"));
	const showMetaRow = $derived(
		Boolean(subtitle) || Boolean(agentLabel) || Boolean(branchLabel) || (badges?.length ?? 0) > 0
	);

	function actionDisabled(action: AgentPanelActionDescriptor): boolean {
		return action.state === "disabled" || action.state === "busy";
	}

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}
</script>

<EmbeddedPanelHeader
	onHeaderClick={onScrollToTop}
	class="{showTrailingBorder ? 'border-r border-border/50' : ''} {className}"
>
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
				<ProjectLetterBadge
					name={projectName}
					color={projectColor}
					iconSrc={projectIconSrc}
					size={14}
					sequenceId={sequenceId}
					class="shrink-0"
				/>
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
					{#if visibleActionButtons.length > 0}
						<div class="flex items-center gap-1 px-1">
							{#each visibleActionButtons as action (action.id)}
								<Button
									variant={action.destructive ? "destructive" : "headerAction"}
									size="headerAction"
									disabled={actionDisabled(action)}
									title={action.description ?? undefined}
									onclick={() => runAction(action)}
								>
									{action.label ?? action.id}
								</Button>
							{/each}
						</div>
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

{#if showMetaRow}
	<div
		class="flex flex-wrap items-center gap-1.5 border-b border-border/50 px-3 pb-2 text-[11px] text-muted-foreground {showTrailingBorder
			? 'border-r border-border/50'
			: ''}"
	>
		{#if subtitle}
			<span class="font-medium text-foreground/80">{subtitle}</span>
		{/if}
		{#if agentLabel}
			<span>Agent: {agentLabel}</span>
		{/if}
		{#if branchLabel}
			<span>Branch: {branchLabel}</span>
		{/if}
		{#each badges ?? [] as badge (badge.id)}
			<span class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px]">
				{badge.label}
			</span>
		{/each}
	</div>
{/if}
