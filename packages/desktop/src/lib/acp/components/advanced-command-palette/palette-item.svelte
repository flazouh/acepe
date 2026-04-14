<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui/project-letter-badge";
import { FileIcon } from "$lib/components/ui/file-icon/index.js";
import * as Kbd from "$lib/components/ui/kbd/index.js";
import AgentIcon from "../../components/agent-icon.svelte";
import type { PaletteItem } from "../../types/palette-item.js";

interface Props {
	/** The item to display */
	item: PaletteItem;
	/** Current search query for highlighting */
	query?: string;
	/** Whether this item is selected */
	isSelected: boolean;
	/** Whether this is the last item */
	isLast: boolean;
	/** Callback when clicked */
	onclick: () => void;
	/** Callback when mouse enters */
	onmouseenter: () => void;
}

let { item, query = "", isSelected, isLast, onclick, onmouseenter }: Props = $props();

const Icon = $derived(item.icon);

/** Check if this is a file item (has extension metadata) */
const isFileItem = $derived(item.metadata.extension !== undefined);

/** Check if this is a session item (has agentId metadata) */
const isSessionItem = $derived(item.metadata.agentId !== undefined);

/** Parse keybinding string like "Cmd+T" into key parts */
const keybindingParts = $derived.by(() => {
	if (!item.metadata.keybinding) return [];
	return item.metadata.keybinding.split("+").map((k) => {
		if (k === "Cmd") return "⌘";
		if (k === "Shift") return "⇧";
		if (k === "Alt") return "⌥";
		if (k === "Ctrl") return "⌃";
		return k;
	});
});

/** Split label into segments with match highlighting */
const labelSegments = $derived.by(() => {
	if (!query.trim()) return [{ text: item.label, match: false }];

	const lowerLabel = item.label.toLowerCase();
	const lowerQuery = query.toLowerCase().trim();
	const matchIndex = lowerLabel.indexOf(lowerQuery);

	if (matchIndex === -1) return [{ text: item.label, match: false }];

	const segments: Array<{ text: string; match: boolean }> = [];
	if (matchIndex > 0) {
		segments.push({ text: item.label.slice(0, matchIndex), match: false });
	}
	segments.push({
		text: item.label.slice(matchIndex, matchIndex + lowerQuery.length),
		match: true,
	});
	if (matchIndex + lowerQuery.length < item.label.length) {
		segments.push({ text: item.label.slice(matchIndex + lowerQuery.length), match: false });
	}
	return segments;
});
</script>

<button
	type="button"
	class="w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-left group transition-colors duration-100 {isSelected
		? 'bg-accent text-accent-foreground'
		: 'hover:bg-accent/40'} {isLast ? 'rounded-b-lg' : ''}"
	{onclick}
	{onmouseenter}
>
	<!-- Icon -->
	{#if isSessionItem && item.metadata.projectName && item.metadata.projectColor}
		<ProjectLetterBadge
			name={item.metadata.projectName}
			color={item.metadata.projectColor}
			iconSrc={item.metadata.projectIconSrc}
			size={18}
		/>
	{:else if isFileItem}
		<FileIcon extension={item.metadata.extension} class="size-3.5 shrink-0" />
	{:else if isSessionItem && item.metadata.agentId}
		<AgentIcon agentId={item.metadata.agentId} size={14} class="shrink-0" />
	{:else}
		<Icon
			class="size-3.5 shrink-0 transition-colors duration-100 {isSelected
				? 'text-primary'
				: 'text-muted-foreground group-hover:text-foreground'}"
			weight="fill"
		/>
	{/if}

	<!-- Content -->
	<div class="flex-1 min-w-0">
		<span class="truncate block"
			>{#each labelSegments as seg, i (i)}{#if seg.match}<mark
						class="bg-transparent text-primary font-semibold">{seg.text}</mark
					>{:else}{seg.text}{/if}{/each}</span
		>
	</div>

	<!-- Keybinding -->
	{#if keybindingParts.length > 0}
		<Kbd.Group class="shrink-0 opacity-50">
			{#each keybindingParts as key, i (i)}
				<Kbd.Root class="text-[10px]">{key}</Kbd.Root>
			{/each}
		</Kbd.Group>
	{/if}
</button>
