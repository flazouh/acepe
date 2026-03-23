<script lang="ts">
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
import IconPlus from "@tabler/icons-svelte/icons/plus";
import IconTerminal from "@tabler/icons-svelte/icons/terminal";
import IconX from "@tabler/icons-svelte/icons/x";
import type { TerminalPanel } from "$lib/acp/store/terminal-panel-type.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	projectName: string;
	projectColor: string | undefined;
	shell: string | null;
	hideProjectBadge?: boolean;
	onClose: () => void;
	/** When true, terminal is the aux panel in fullscreen layout (show "Exit fullscreen"). */
	isAuxFullscreen?: boolean;
	onEnterFullscreen?: () => void;
	onExitFullscreen?: () => void;
	/** Tab support */
	tabs?: readonly TerminalPanel[];
	selectedTabId?: string | null;
	onSelectTab?: (id: string) => void;
	onNewTab?: () => void;
	onCloseTab?: (id: string) => void;
}

let {
	projectName,
	projectColor,
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
}: Props = $props();

const effectiveColor = $derived(projectColor ?? "");
const shellName = $derived(shell?.split("/").pop() ?? null);
const showFullscreen = $derived(onEnterFullscreen !== undefined || onExitFullscreen !== undefined);
const hasTabs = $derived(tabs !== undefined && tabs.length > 0);

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
					class="flex items-center gap-1 px-2 text-xs cursor-pointer border-r border-border/30 transition-colors
						{selectedTabId === tab.id
						? 'bg-accent'
						: 'hover:bg-accent/50'}"
						role="tab"
						tabindex="0"
						aria-selected={selectedTabId === tab.id}
						onclick={() => onSelectTab?.(tab.id)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								onSelectTab?.(tab.id);
							}
						}}
					>
						<span class="whitespace-nowrap text-[11px]">{m.terminal_panel_title()} {i + 1}</span>
						{#if tabs && tabs.length > 1}
							<button
								type="button"
								class="shrink-0 inline-flex h-4 w-4 items-center justify-center rounded
									opacity-50 hover:opacity-100 hover:bg-muted-foreground/10 cursor-pointer"
								title={m.common_close()}
								onclick={(e) => {
									e.stopPropagation();
									onCloseTab?.(tab.id);
								}}
							>
								<IconX class="h-3 w-3" />
								<span class="sr-only">{m.common_close()}</span>
							</button>
						{/if}
					</div>
				{/each}
		</div>
	{:else}
		<HeaderTitleCell>
			<div class="flex items-center gap-1.5 min-w-0">
				<IconTerminal class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span class="text-[11px] font-medium truncate">{m.terminal_panel_title()}</span>
				{#if shellName}
					<span class="text-[11px] text-muted-foreground truncate">({shellName})</span>
				{/if}
			</div>
		</HeaderTitleCell>
	{/if}

	<HeaderActionCell withDivider={true}>
		{#if onNewTab}
			<EmbeddedIconButton
				title={m.terminal_new_tab()}
				onclick={onNewTab}
			>
				<IconPlus class="h-3.5 w-3.5" />
			</EmbeddedIconButton>
		{/if}
		{#if showFullscreen}
			<FullscreenAction
				isFullscreen={isAuxFullscreen}
				onToggle={handleFullscreenToggle}
				titleEnter={m.panel_fullscreen()}
				titleExit={m.panel_exit_fullscreen()}
			/>
		{/if}
		<CloseAction {onClose} title={m.common_close()} />
	</HeaderActionCell>
</EmbeddedPanelHeader>
