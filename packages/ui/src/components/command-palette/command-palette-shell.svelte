<script lang="ts">
	import MagnifyingGlass from "phosphor-svelte/lib/MagnifyingGlass";

	import * as Dialog from "../dialog/index.js";

	import type { PaletteItem, PaletteMode } from "./types.js";
	import CommandPaletteResults from "./command-palette-results.svelte";
	import CommandPaletteTabs from "./command-palette-tabs.svelte";

	interface Props {
		/** Whether the command palette is open */
		open: boolean;
		/** Callback when the open state changes */
		onOpenChange: (open: boolean) => void;
		/** Current search placeholder */
		placeholder: string;
		/** Current search query */
		query: string;
		/** Current active mode */
		mode: PaletteMode;
		/** Available modes with labels */
		modes: Array<{ mode: PaletteMode; label: string }>;
		/** Current result items */
		items: PaletteItem[];
		/** Current selected result index */
		selectedIndex: number;
		/** Whether the recent section is shown */
		hasRecentSection: boolean;
		/** Index where the recent section ends */
		recentSectionEndIndex: number;
		/** Bound search input element reference */
		inputRef?: HTMLInputElement | null;
		/** Callback when the query changes */
		onQueryChange: (query: string) => void;
		/** Callback for keyboard interaction */
		onKeyDown: (event: KeyboardEvent) => void;
		/** Callback when the mode changes */
		onModeChange: (mode: PaletteMode) => void;
		/** Callback when the selected item is activated */
		onSelect: () => void;
		/** Callback when an item is hovered */
		onHover: (index: number) => void;
		/** Optional resolver for session agent icons */
		getAgentIconSrc?: (agentId: string) => string | undefined;
	}

	let {
		open = $bindable(),
		onOpenChange,
		placeholder,
		query,
		mode,
		modes,
		items,
		selectedIndex,
		hasRecentSection,
		recentSectionEndIndex,
		inputRef = $bindable(null),
		onQueryChange,
		onKeyDown,
		onModeChange,
		onSelect,
		onHover,
		getAgentIconSrc,
	}: Props = $props();

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		onOpenChange(nextOpen);
	}

	function handleInput(event: Event): void {
		const target = event.currentTarget;
		if (!(target instanceof HTMLInputElement)) {
			return;
		}

		onQueryChange(target.value);
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content
		class="max-w-lg w-full gap-0 overflow-hidden rounded-xl border border-border/40 p-0 shadow-2xl"
		showCloseButton={false}
	>
		<div class="flex flex-col">
			<div class="flex items-center gap-2 border-b border-border/30 px-3 py-2">
				<MagnifyingGlass class="size-3.5 shrink-0 text-muted-foreground/50" weight="bold" />
				<input
					bind:this={inputRef}
					type="text"
					placeholder={placeholder}
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					class="flex-1 border-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/40"
					value={query}
					oninput={handleInput}
					onkeydown={onKeyDown}
				/>
			</div>

			<CommandPaletteTabs {mode} {modes} {onModeChange} />

			<CommandPaletteResults
				{items}
				{query}
				{selectedIndex}
				{hasRecentSection}
				{recentSectionEndIndex}
				{onSelect}
				{onHover}
				{getAgentIconSrc}
			/>

			<div class="flex items-center justify-between border-t border-border/20 px-3 py-1 text-[9px] text-muted-foreground/40">
				<div class="flex items-center gap-3">
					<span class="flex items-center gap-1">
						<span class="inline-flex items-center gap-1">
							<kbd
								class="pointer-events-none inline-flex min-w-4 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[9px] font-medium text-muted-foreground select-none"
							>
								↑
							</kbd>
							<kbd
								class="pointer-events-none inline-flex min-w-4 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[9px] font-medium text-muted-foreground select-none"
							>
								↓
							</kbd>
						</span>
						<span>navigate</span>
					</span>
					<span class="flex items-center gap-1">
						<kbd
							class="pointer-events-none inline-flex min-w-4 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[9px] font-medium text-muted-foreground select-none"
						>
							↵
						</kbd>
						<span>select</span>
					</span>
				</div>
				<span class="flex items-center gap-1">
					<kbd
						class="pointer-events-none inline-flex min-w-4 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[9px] font-medium text-muted-foreground select-none"
					>
						esc
					</kbd>
					<span>close</span>
				</span>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
