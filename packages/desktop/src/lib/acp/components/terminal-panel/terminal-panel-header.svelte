<script lang="ts">
import {
	Button,
	CloseAction,
	EmbeddedPanelHeader,
	FullscreenAction,
	HeaderActionCell,
	HeaderCell,
	HeaderTitleCell,
	ProjectLetterBadge,
	HugeiconsIcon,
} from "@acepe/ui";
import type { TerminalTab } from "$lib/acp/store/types.js";
import {
	canShowCloseTerminalTabAction,
	canShowMoveTerminalTabAction,
	canShowTerminalTabMenu,
	getNextOpenTerminalTabMenuId,
	getTerminalProjectBadgeColor,
	getTerminalShellName,
	getTerminalTabLabel,
	hasTerminalTabs,
	shouldShowTerminalFullscreenAction,
} from "./terminal-panel-header-state.js";

interface Props {
	projectName: string;
	projectColor: string | undefined;
	projectBadgeLabel?: string | null;
	projectIconSrc?: string | null;
	shell: string | null;
	hideProjectBadge?: boolean;
	onClose: () => void;
	/** When true, terminal is the aux panel in fullscreen layout (show "Exit fullscreen"). */
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
	projectName,
	projectColor,
	projectBadgeLabel = null,
	projectIconSrc = null,
	shell,
	hideProjectBadge = false,
	onClose,
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

let openMenuTabId = $state<string | null>(null);

const TERMINAL_TITLE = "Terminal";
const CLOSE_LABEL = "Close";
const NEW_TAB_LABEL = "New tab";
const ENTER_FULLSCREEN_LABEL = "Enter fullscreen";
const EXIT_FULLSCREEN_LABEL = "Exit fullscreen";
const TAB_ACTIONS_LABEL = "Terminal tab actions";
const OPEN_IN_NEW_PANEL_LABEL = "Open in new panel";

const effectiveColor = $derived(getTerminalProjectBadgeColor(projectColor));
const shellName = $derived(getTerminalShellName(shell));
const showFullscreen = $derived(
	shouldShowTerminalFullscreenAction({ onEnterFullscreen, onExitFullscreen })
);
const hasTabs = $derived(hasTerminalTabs(tabs));

function canShowTabMenu(_tabId: string): boolean {
	return canShowTerminalTabMenu({ tabs, onCloseTab, onMoveTabToNewPanel });
}

function canShowMoveTabAction(tabId: string): boolean {
	return canShowMoveTerminalTabAction({
		tabId,
		tabs,
		onMoveTabToNewPanel,
		canMoveTabToNewPanel,
	});
}

function canShowCloseTabAction(): boolean {
	return canShowCloseTerminalTabAction({ tabs, onCloseTab });
}

function toggleTabMenu(tabId: string): void {
	openMenuTabId = getNextOpenTerminalTabMenuId({ openMenuTabId, tabId });
}

function closeTabMenu(): void {
	openMenuTabId = null;
}

function handleSelectTab(tabId: string): void {
	closeTabMenu();
	onSelectTab?.(tabId);
}

function handleMoveTabToNewPanel(tabId: string): void {
	closeTabMenu();
	onMoveTabToNewPanel?.(tabId);
}

function handleCloseTab(tabId: string): void {
	closeTabMenu();
	onCloseTab?.(tabId);
}

function handleFullscreenToggle() {
	if (isAuxFullscreen) {
		onExitFullscreen?.();
	} else {
		onEnterFullscreen?.();
	}
}
</script>

<EmbeddedPanelHeader>
	{#if !hideProjectBadge}
		<HeaderCell>
			<div class="inline-flex items-center justify-center h-7 w-7 shrink-0">
				<ProjectLetterBadge
					name={projectName}
					label={projectBadgeLabel}
					color={effectiveColor}
					iconSrc={projectIconSrc}
					size={28}
					fontSize={15}
					class="!rounded-none !rounded-tl-lg"
				/>
			</div>
		</HeaderCell>
	{/if}

	{#if hasTabs}
		<!-- Tabs rendered inline in the title area -->
		<div class="h-7 flex items-stretch flex-1 min-w-0 overflow-x-auto" role="tablist">
			{#each tabs as tab, i (tab.id)}
				<div
					class="group/tab relative flex items-center gap-1 px-2 text-xs cursor-pointer border-r border-border/30 transition-colors
						{selectedTabId === tab.id
						? 'bg-accent'
						: 'hover:bg-accent/50'}"
						role="tab"
						tabindex="0"
						aria-selected={selectedTabId === tab.id}
						onclick={() => handleSelectTab(tab.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								handleSelectTab(tab.id);
							}
						}}
					>
						<span class="whitespace-nowrap text-[11px]">{getTerminalTabLabel(i)}</span>
						{#if canShowTabMenu(tab.id)}
							<button
								type="button"
								class="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded transition-opacity hover:bg-muted-foreground/10 cursor-pointer focus-visible:opacity-100 {selectedTabId === tab.id
									? 'opacity-100'
									: 'opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100'}"
								aria-label={TAB_ACTIONS_LABEL}
								onclick={(e) => {
									e.stopPropagation();
									toggleTabMenu(tab.id);
								}}
							>
								<HugeiconsIcon name="more" class="h-3 w-3" />
							</button>
							{#if openMenuTabId === tab.id}
								<div class="absolute right-1 top-6 z-20 min-w-[160px] rounded-lg border border-border bg-background p-1 shadow-md">
									{#if canShowMoveTabAction(tab.id)}
										<button
											type="button"
											role="menuitem"
											class="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
											onclick={(e) => {
												e.stopPropagation();
												handleMoveTabToNewPanel(tab.id);
											}}
										>
											{OPEN_IN_NEW_PANEL_LABEL}
										</button>
									{/if}
									{#if canShowCloseTabAction()}
										<button
											type="button"
											role="menuitem"
											class="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] hover:bg-accent"
											onclick={(e) => {
												e.stopPropagation();
												handleCloseTab(tab.id);
											}}
										>
											{CLOSE_LABEL}
										</button>
									{/if}
								</div>
							{/if}
						{/if}
					</div>
			{/each}
		</div>
	{:else}
		<HeaderTitleCell>
			<div class="flex items-center gap-1.5 min-w-0">
				<HugeiconsIcon name="terminal" class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span class="text-[11px] font-medium truncate">{TERMINAL_TITLE}</span>
				{#if shellName}
					<span class="text-[11px] text-muted-foreground truncate">({shellName})</span>
				{/if}
			</div>
		</HeaderTitleCell>
	{/if}

	<HeaderActionCell withDivider={true}>
		{#if onNewTab}
			<Button
				variant="ghost"
				size="icon"
				data-header-control
				title={NEW_TAB_LABEL}
				aria-label={NEW_TAB_LABEL}
				onclick={onNewTab}
			>
				{#snippet children()}
					<HugeiconsIcon name="plus" size={14} />
				{/snippet}
			</Button>
		{/if}
		{#if showFullscreen}
			<FullscreenAction
				isFullscreen={isAuxFullscreen}
				onToggle={handleFullscreenToggle}
				titleEnter={ENTER_FULLSCREEN_LABEL}
				titleExit={EXIT_FULLSCREEN_LABEL}
			/>
		{/if}
		<CloseAction {onClose} title={CLOSE_LABEL} />
	</HeaderActionCell>
</EmbeddedPanelHeader>
