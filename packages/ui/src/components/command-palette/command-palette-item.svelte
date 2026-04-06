<script lang="ts">
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { getFallbackIconSrc, getFileIconSrc } from "../../lib/file-icon/index.js";

	import type { PaletteItem } from "./types.js";

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
		/** Optional resolver for session agent icons */
		getAgentIconSrc?: (agentId: string) => string | undefined;
	}

	let {
		item,
		query = "",
		isSelected,
		isLast,
		onclick,
		onmouseenter,
		getAgentIconSrc,
	}: Props = $props();

	const Icon = $derived(item.icon);
	const isFileItem = $derived(item.metadata.extension !== undefined);
	const isSessionItem = $derived(item.metadata.agentId !== undefined);
	const sessionIconSrc = $derived.by(() => {
		if (!item.metadata.agentId || !getAgentIconSrc) {
			return undefined;
		}

		return getAgentIconSrc(item.metadata.agentId);
	});
	const fileIconSrc = $derived.by(() => {
		if (!item.metadata.extension) {
			return "";
		}

		return getFileIconSrc(item.metadata.extension);
	});
	const fallbackFileIconSrc = getFallbackIconSrc();

	function handleFileIconError(event: Event): void {
		const image = event.currentTarget;
		if (!(image instanceof HTMLImageElement) || image.src === fallbackFileIconSrc) {
			return;
		}

		image.src = fallbackFileIconSrc;
	}

	const keybindingParts = $derived.by(() => {
		if (!item.metadata.keybinding) return [];
		return item.metadata.keybinding.split("+").map((key) => {
			if (key === "Cmd") return "⌘";
			if (key === "Shift") return "⇧";
			if (key === "Alt") return "⌥";
			if (key === "Ctrl") return "⌃";
			return key;
		});
	});

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
	class="group flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] transition-colors duration-100 {isSelected
		? 'bg-accent text-accent-foreground'
		: 'hover:bg-accent/40'} {isLast ? 'rounded-b-lg' : ''}"
	{onclick}
	{onmouseenter}
>
	{#if isSessionItem && item.metadata.projectName && item.metadata.projectColor}
		<ProjectLetterBadge
			name={item.metadata.projectName}
			color={item.metadata.projectColor}
			size={18}
		/>
	{:else if isFileItem && fileIconSrc}
		<img
			src={fileIconSrc}
			alt=""
			aria-hidden="true"
			class="size-3.5 shrink-0"
			onerror={handleFileIconError}
		/>
	{:else if isSessionItem && sessionIconSrc}
		<img src={sessionIconSrc} alt="" aria-hidden="true" class="size-3.5 shrink-0" />
	{:else}
		<Icon
			class="size-3.5 shrink-0 transition-colors duration-100 {isSelected
				? 'text-primary'
				: 'text-muted-foreground group-hover:text-foreground'}"
			weight="fill"
		/>
	{/if}

	<div class="min-w-0 flex-1">
		<span class="block truncate"
			>{#each labelSegments as segment, index (index)}{#if segment.match}<mark
						class="bg-transparent font-semibold text-primary">{segment.text}</mark
					>{:else}{segment.text}{/if}{/each}</span
		>
	</div>

	{#if keybindingParts.length > 0}
		<span class="inline-flex shrink-0 items-center gap-1 opacity-50">
			{#each keybindingParts as key, index (index)}
				<kbd
					class="pointer-events-none inline-flex min-w-4 items-center justify-center rounded border border-border bg-background px-1 font-sans text-[10px] font-medium text-muted-foreground select-none"
				>
					{key}
				</kbd>
			{/each}
		</span>
	{/if}
</button>
