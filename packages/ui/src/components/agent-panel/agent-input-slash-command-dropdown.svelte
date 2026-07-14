<script lang="ts">
	import * as Dialog from "../dialog/index.js";
	import { NativeMarkdown } from "../native-markdown/index.js";
	import AgentInputSlashPaletteRow from "./agent-input-slash-palette-row.svelte";
	import { HugeiconsIcon } from "../icons/index.js";
	import { getSlashCommandIconColor } from "./agent-input-slash-command-row-state.js";
	import {
		getSlashCommandWorkspaceMarkdown,
		type AgentInputSlashCommand,
		type AgentInputSlashCommandTokenType,
		type AgentInputSlashCommandWorkspaceMarkdownResult,
	} from "./agent-input-slash-command-dropdown-state.js";
	import {
		flattenSlashPaletteItems,
		getEffectiveSlashPaletteIndex,
		getNextSlashPaletteIndex,
		getSlashPaletteEmptyState,
		getSlashPaletteVisibleSections,
		type SlashPaletteItem,
		type SlashPaletteSection,
		type SlashPaletteSectionId,
	} from "./agent-input-slash-palette-state.js";

	export type {
		AgentInputSlashCommand,
		AgentInputSlashCommandWorkspaceMarkdownResult,
	} from "./agent-input-slash-command-dropdown-state.js";
	export type {
		SlashPaletteItem,
		SlashPaletteSection,
		SlashPaletteSectionId,
	} from "./agent-input-slash-palette-state.js";

	interface Props {
		sections: readonly SlashPaletteSection[];
		isOpen: boolean;
		query: string;
		position: { top: number; left: number };
		noContentLabel?: string;
		noResultsLabel?: string;
		startTypingLabel?: string;
		selectHintLabel?: string;
		closeHintLabel?: string;
		showMoreLabel?: (hiddenCount: number) => string;
		loadWorkspaceMarkdown?: (input: {
			readonly command: AgentInputSlashCommand;
			readonly tokenType: AgentInputSlashCommandTokenType;
		}) => Promise<AgentInputSlashCommandWorkspaceMarkdownResult>;
		onItemSelect: (item: SlashPaletteItem) => void;
		onClose: () => void;
	}

	let {
		sections,
		isOpen,
		query,
		position,
		noContentLabel = "Nothing available",
		noResultsLabel = "No matching items",
		startTypingLabel = "Start typing to filter",
		selectHintLabel = "Select",
		closeHintLabel = "Close",
		showMoreLabel = (hiddenCount: number) => `Show ${hiddenCount} more`,
		loadWorkspaceMarkdown,
		onItemSelect,
		onClose,
	}: Props = $props();

	let selectedIndex = $state(0);
	let itemRefs = $state<Record<number, HTMLDivElement>>({});
	let expandedSectionIds = $state<Set<SlashPaletteSectionId>>(new Set());
	let workspaceItem = $state<SlashPaletteItem | null>(null);
	let workspaceOpen = $state(false);
	let loadedWorkspaceMarkdown = $state<string | null>(null);
	let workspaceMarkdownLoading = $state(false);
	let workspaceMarkdownError = $state<string | null>(null);

	function portalToBody(node: HTMLElement): { destroy: () => void } {
		document.body.appendChild(node);
		return {
			destroy(): void {
				node.remove();
			},
		};
	}

	const visibleSections = $derived(
		getSlashPaletteVisibleSections({
			sections,
			query,
			expandedSectionIds,
		})
	);
	const flatEntries = $derived(flattenSlashPaletteItems(visibleSections));
	const flatIndexByItemId = $derived.by(() => {
		const map = new Map<string, number>();
		for (const entry of flatEntries) {
			map.set(`${entry.sectionId}:${entry.item.id}`, entry.flatIndex);
		}
		return map;
	});
	const effectiveSelectedIndex = $derived(
		getEffectiveSlashPaletteIndex({
			selectedIndex,
			itemCount: flatEntries.length,
		})
	);
	const emptyState = $derived(
		getSlashPaletteEmptyState({
			sectionCount: sections.length,
			visibleItemCount: flatEntries.length,
			query,
		})
	);
	const workspaceCommand = $derived(
		workspaceItem && workspaceItem.commandName
			? {
					name: workspaceItem.commandName,
					description: workspaceItem.description ?? "",
					input: null,
				}
			: null
	);
	const workspaceTokenType = $derived(workspaceItem?.tokenType ?? "command");
	const fallbackWorkspaceMarkdown = $derived(
		workspaceCommand
			? getSlashCommandWorkspaceMarkdown({
					command: workspaceCommand,
					tokenType: workspaceTokenType,
				})
			: ""
	);
	const workspaceMarkdown = $derived(
		loadedWorkspaceMarkdown
			? `${fallbackWorkspaceMarkdown}\n\n---\n\n## Skill content\n\n${loadedWorkspaceMarkdown}`
			: fallbackWorkspaceMarkdown
	);
	const iconColor = $derived(getSlashCommandIconColor(workspaceTokenType));

	function scrollSelectedIntoView(): void {
		const item = itemRefs[effectiveSelectedIndex];
		if (item) {
			item.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}

	function expandSection(sectionId: SlashPaletteSectionId): void {
		const next = new Set(expandedSectionIds);
		next.add(sectionId);
		expandedSectionIds = next;
	}

	export function handleKeyDown(event: KeyboardEvent): boolean {
		if (!isOpen) {
			return false;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			selectedIndex = getNextSlashPaletteIndex({
				currentIndex: effectiveSelectedIndex,
				itemCount: flatEntries.length,
				direction: "down",
			});
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			selectedIndex = getNextSlashPaletteIndex({
				currentIndex: effectiveSelectedIndex,
				itemCount: flatEntries.length,
				direction: "up",
			});
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "Enter" || event.key === "Tab") {
			const selectedEntry = flatEntries[effectiveSelectedIndex];
			if (selectedEntry) {
				event.preventDefault();
				onItemSelect(selectedEntry.item);
				return true;
			}
			return false;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return true;
		}

		return false;
	}

	function openWorkspaceModal(item: SlashPaletteItem): void {
		workspaceItem = item;
		loadedWorkspaceMarkdown = null;
		workspaceMarkdownError = null;
		workspaceOpen = true;
		if (!loadWorkspaceMarkdown || item.tokenType !== "skill" || !item.commandName) {
			return;
		}

		const command = {
			name: item.commandName,
			description: item.description ?? "",
			input: null,
		};
		workspaceMarkdownLoading = true;
		loadWorkspaceMarkdown({ command, tokenType: "skill" }).then(
			(result) => {
				if (workspaceItem?.id !== item.id) {
					return;
				}
				workspaceMarkdownLoading = false;
				if (result.status === "ready") {
					loadedWorkspaceMarkdown = result.markdown;
					workspaceMarkdownError = null;
					return;
				}
				workspaceMarkdownError = result.message;
			},
			() => {
				if (workspaceItem?.id !== item.id) {
					return;
				}
				workspaceMarkdownLoading = false;
				workspaceMarkdownError = "Unable to load full details.";
			}
		);
	}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portalToBody
		class="fixed z-[var(--overlay-z)] w-80 overflow-hidden rounded-lg border bg-popover/98 shadow-xl backdrop-blur"
		style="top: {position.top}px; left: {position.left}px; transform: translateY(-100%); margin-top: -6px;"
		onmousedown={(event) => event.preventDefault()}
	>
		{#if flatEntries.length > 0}
			<div class="flex max-h-72 flex-col overflow-y-auto pb-1">
				{#each visibleSections as section, sectionIndex (section.id)}
					<div class="px-2 pb-0.5 {sectionIndex === 0 ? 'pt-1' : 'pt-2'}">
						<span class="text-[11px] font-medium text-muted-foreground">{section.label}</span>
					</div>
					{#each section.items as item (item.id)}
						{@const flatIndex =
							flatIndexByItemId.get(`${section.id}:${item.id}`) ?? 0}
						{@const isSelected = flatIndex === effectiveSelectedIndex}
						<div bind:this={itemRefs[flatIndex]}>
							<AgentInputSlashPaletteRow
								{item}
								selected={isSelected}
								showPreviewButton={item.kind === "skill"}
								onSelect={() => onItemSelect(item)}
								onPreview={() => openWorkspaceModal(item)}
								onHover={() => {
									selectedIndex = flatIndex;
								}}
							/>
						</div>
					{/each}
					{#if section.hiddenCount > 0}
						<button
							type="button"
							class="mx-1 block w-[calc(100%-0.5rem)] rounded-md px-2 py-1.5 text-left text-[11px] text-muted-foreground transition hover:bg-accent/50 hover:text-foreground"
							onclick={() => expandSection(section.id)}
						>
							{showMoreLabel(section.hiddenCount)}
						</button>
					{/if}
				{/each}
			</div>

			<div class="flex items-center gap-1.5 border-t border-border/60 bg-muted/20 px-2.5 py-1 shrink-0">
				<kbd class="rounded border bg-muted px-1 py-0.5 text-[10px] font-medium leading-none">Enter</kbd>
				<span class="text-[10px] text-muted-foreground">{selectHintLabel}</span>
				<kbd class="ml-1 rounded-lg border bg-muted px-1 py-0.5 text-[10px] font-medium leading-none">Esc</kbd>
				<span class="text-[10px] text-muted-foreground">{closeHintLabel}</span>
			</div>
		{:else if emptyState === "no-content"}
			<div class="px-3 py-3 text-center text-[12px] text-muted-foreground">{noContentLabel}</div>
		{:else if emptyState === "no-results"}
			<div class="px-3 py-3 text-center text-[12px] text-muted-foreground">{noResultsLabel}</div>
		{:else}
			<div class="px-3 py-3 text-center text-[12px] text-muted-foreground">{startTypingLabel}</div>
		{/if}
	</div>
{/if}

<Dialog.Root bind:open={workspaceOpen}>
	<Dialog.Content
		class="max-h-[82vh] max-w-2xl overflow-hidden p-0"
		style="z-index: calc(var(--overlay-z) + 10);"
		showCloseButton={true}
	>
		<div class="border-b border-border/60 px-4 py-3">
			<Dialog.Title class="flex items-center gap-2 text-sm">
				<span class="flex h-5 w-5 items-center justify-center rounded-md" style="color: {iconColor};">
					{#if workspaceTokenType === "skill"}
						<HugeiconsIcon name="skills" class="h-3 w-3" data-testid="slash-command-skill-icon" />
					{:else if workspaceTokenType === "mcp"}
						<HugeiconsIcon name="mcp" class="h-3 w-3" />
					{:else}
						<HugeiconsIcon name="terminal" class="h-3 w-3" />
					{/if}
				</span>
				{workspaceItem ? workspaceItem.label : "Details"}
			</Dialog.Title>
			<Dialog.Description class="mt-1">
				Readable workspace preview with markdown and highlighted code blocks.
			</Dialog.Description>
		</div>
		<div class="max-h-[68vh] overflow-y-auto px-4 py-3">
			{#if workspaceMarkdownLoading}
				<div class="mb-3 text-[11px] text-muted-foreground">Loading full skill content...</div>
			{/if}
			{#if workspaceMarkdownError}
				<div class="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
					{workspaceMarkdownError}
				</div>
			{/if}
			<NativeMarkdown
				markdown={workspaceMarkdown}
				mode="static"
				class="text-[12px] leading-relaxed"
			/>
		</div>
	</Dialog.Content>
</Dialog.Root>
