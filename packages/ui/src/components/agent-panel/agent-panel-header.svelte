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
	import {
		getAgentPanelHeaderTitle,
		getHeaderStatusIndicatorKind,
		getVisibleHeaderActionButtons,
		hasAgentPanelHeaderExpansion,
		hasAgentPanelHeaderMetaChips,
		isHeaderActionDisabled,
		shouldShowAgentPanelHeaderExpansion,
	} from "./agent-panel-header-state.js";
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
		leadingControl?: Snippet;
		dropdownMenu?: Snippet;
		trailingActions?: Snippet;
		/** Renders in the action cell before the dropdown menu — use for status icons. */
		statusAction?: Snippet;
		controls?: Snippet;
		/**
		 * Optional hover-expansion slot. When provided, it renders inside a panel that
		 * animates open on hover/focus-within of the header. When absent, a default
		 * expansion showing subtitle/agentLabel/branchLabel/badges is used if any are set.
		 */
		expansion?: Snippet;
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
		leadingControl,
		dropdownMenu,
		trailingActions,
		statusAction,
		controls,
		expansion,
		subtitle,
		agentLabel,
		branchLabel,
		badges = [],
		actionButtons = [],
		actionCallbacks = {},
		showTrailingBorder = false,
		class: className = "",
	}: Props = $props();

	const visibleActionButtons = $derived(getVisibleHeaderActionButtons(actionButtons));
	const resolvedTitle = $derived(getAgentPanelHeaderTitle({ displayTitle, sessionTitle }));
	const hasMetaChips = $derived(
		hasAgentPanelHeaderMetaChips({ subtitle, agentLabel, branchLabel, badges })
	);
	const hasExpansion = $derived(
		hasAgentPanelHeaderExpansion({
			pendingProjectSelection,
			hasExpansionSlot: Boolean(expansion),
			hasMetaChips,
		})
	);
	const statusIndicatorKind = $derived(
		getHeaderStatusIndicatorKind({
			hasCustomStatusIndicator: Boolean(statusIndicator),
			isConnecting,
			sessionStatus,
		})
	);
	let titleHoverRef: HTMLDivElement | undefined = $state();
	let expansionPanelRef: HTMLDivElement | undefined = $state();
	let expansionActive = $state(false);
	const showExpansion = $derived(
		shouldShowAgentPanelHeaderExpansion({ hasExpansion, expansionActive })
	);

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}

	function containsExpansionTarget(target: EventTarget | null): boolean {
		if (!(target instanceof Node)) {
			return false;
		}
		return Boolean(titleHoverRef?.contains(target) || expansionPanelRef?.contains(target));
	}

	function openExpansion(): void {
		if (!hasExpansion) {
			return;
		}
		expansionActive = true;
	}

	function closeExpansion(event: MouseEvent | FocusEvent): void {
		if (containsExpansionTarget(event.relatedTarget)) {
			return;
		}
		expansionActive = false;
	}
</script>

<div class="relative {className}">
	<EmbeddedPanelHeader
		onHeaderClick={onScrollToTop}
	>
		{#if pendingProjectSelection}
			{#if leadingControl}
				<HeaderCell withDivider={false}>
					{@render leadingControl()}
				</HeaderCell>
			{/if}
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
			{#if leadingControl}
				<HeaderCell>
					{@render leadingControl()}
				</HeaderCell>
			{:else if agentIconSrc}
				<HeaderCell>
					<img src={agentIconSrc} alt="" class="w-3.5 h-3.5" role="presentation" />
				</HeaderCell>
			{/if}
			<HeaderTitleCell>
				{#snippet children()}
					<div
						bind:this={titleHoverRef}
						role="group"
						class="flex items-center gap-1.5 min-w-0 flex-1"
						onmouseenter={openExpansion}
						onmouseleave={closeExpansion}
						onfocusin={openExpansion}
						onfocusout={closeExpansion}
					>
						{#if statusIndicatorKind === "custom" && statusIndicator}
							{@render statusIndicator()}
						{:else if statusIndicatorKind === "connecting"}
							<span class="relative flex h-2 w-2 shrink-0">
								<span
									class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-muted-foreground"
								></span>
								<span class="relative inline-flex rounded-full h-2 w-2 bg-muted-foreground"></span>
							</span>
						{:else if statusIndicatorKind === "connected"}
							<span class="h-2 w-2 rounded-full shrink-0 bg-success"></span>
						{:else if statusIndicatorKind === "error"}
							<span class="h-2 w-2 rounded-full shrink-0 bg-destructive"></span>
						{/if}
						<span
							class="agent-panel-header-title min-w-0 truncate text-[12px] font-medium text-foreground"
							class:has-expansion={showExpansion}
							title={resolvedTitle}
						>
							{resolvedTitle}
						</span>
					</div>
				{/snippet}
			</HeaderTitleCell>

			<HeaderActionCell withDivider={false}>
				{#snippet children()}
					{#if controls}
						{@render controls()}
					{:else}
						{#if statusAction}
							{@render statusAction()}
						{/if}
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
										disabled={isHeaderActionDisabled(action)}
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

	{#if hasExpansion}
		<div
			bind:this={expansionPanelRef}
			class="agent-panel-header-expansion absolute left-0 right-0 top-full z-20 border-b border-border/50 bg-card"
			class:is-active={showExpansion}
			role="region"
			aria-label="Session context"
			onmouseenter={openExpansion}
			onmouseleave={closeExpansion}
			onfocusin={openExpansion}
			onfocusout={closeExpansion}
		>
			<div class="expansion-inner">
				<div class="px-3 pt-1.5 pb-1">
					<p
							class="m-0 max-h-12 overflow-y-auto scrollbar-thin text-[12px] font-medium text-foreground"
					>
						{resolvedTitle}
					</p>
					{#if expansion}
						<div class="mt-1">
							{@render expansion()}
						</div>
					{:else if hasMetaChips}
						<div class="mt-1 flex flex-wrap items-center gap-1">
							{#if subtitle}
								<span
									class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
									>{subtitle}</span
								>
							{/if}
							{#if agentLabel}
								<span
									class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
									>{agentLabel}</span
								>
							{/if}
							{#if branchLabel}
								<span
									class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
									>{branchLabel}</span
								>
							{/if}
							{#each badges ?? [] as badge (badge.id)}
								<span
									class="rounded-full border border-border/50 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground"
								>
									{badge.label}
								</span>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.agent-panel-header-title.has-expansion {
		opacity: 0;
	}
	.agent-panel-header-expansion {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		pointer-events: none;
	}
	.agent-panel-header-expansion > .expansion-inner {
		overflow: hidden;
		min-height: 0;
	}
	.agent-panel-header-expansion.is-active {
		grid-template-rows: 1fr;
		opacity: 1;
		pointer-events: auto;
	}
</style>
