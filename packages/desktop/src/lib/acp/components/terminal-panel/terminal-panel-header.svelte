<script lang="ts">
import { IconDotsVertical } from "@tabler/icons-svelte";
import {
	CloseAction,
	EmbeddedIconButton,
	EmbeddedPanelHeader,
	FullscreenAction,
	HeaderActionCell,
	HeaderCell,
	HeaderTitleCell,
	ProjectLetterBadge,
} from "@acepe/ui";
import { IconPlus } from "@tabler/icons-svelte";
import { IconTerminal } from "@tabler/icons-svelte";
import type { TerminalTab } from "$lib/acp/store/types.js";

interface Props {
	projectName: string;
	projectColor: string | undefined;
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

const effectiveColor = $derived(projectColor ? projectColor : "");
const shellName = $derived(shell ? (shell.split("/").pop() ? shell.split("/").pop() : null) : null);
const showFullscreen = $derived(onEnterFullscreen !== undefined || onExitFullscreen !== undefined);
const hasTabs = $derived(tabs !== undefined && tabs.length > 0);

function canShowTabMenu(_tabId: string): boolean {
	if (tabs === undefined) {
		return false;
	}

	return onCloseTab !== undefined || onMoveTabToNewPanel !== undefined;
}

function canShowMoveTabAction(tabId: string): boolean {
	if (!tabs || tabs.length <= 1) {
		return false;
	}
	if (!onMoveTabToNewPanel) {
		return false;
	}
	return canMoveTabToNewPanel ? canMoveTabToNewPanel(tabId) : false;
}

function canShowCloseTabAction(): boolean {
	if (!tabs) {
		return false;
	}
	return tabs.length > 1 && onCloseTab !== undefined;
}

function toggleTabMenu(tabId: string): void {
	openMenuTabId = openMenuTabId === tabId ? null : tabId;
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
						<span class="whitespace-nowrap text-[11px]">{TERMINAL_TITLE} {i + 1}</span>
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
								<IconDotsVertical class="h-3 w-3" />
							</button>
							{#if openMenuTabId === tab.id}
								<div class="absolute right-1 top-6 z-20 min-w-[160px] rounded-md border border-border bg-background p-1 shadow-md">
									{#if canShowMoveTabAction(tab.id)}
										<button
											type="button"
											role="menuitem"
											class="flex w-full items-center rounded px-2 py-1.5 text-left text-[11px] hover:bg-accent"
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
											class="flex w-full items-center rounded px-2 py-1.5 text-left text-[11px] hover:bg-accent"
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
				<IconTerminal class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span class="text-[11px] font-medium truncate">{TERMINAL_TITLE}</span>
				{#if shellName}
					<span class="text-[11px] text-muted-foreground truncate">({shellName})</span>
				{/if}
			</div>
		</HeaderTitleCell>
	{/if}

	<HeaderActionCell withDivider={true}>
		{#if onNewTab}
			<EmbeddedIconButton
				title={NEW_TAB_LABEL}
				onclick={onNewTab}
			>
				<IconPlus class="h-3.5 w-3.5" />
			</EmbeddedIconButton>
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
