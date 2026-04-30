<script lang="ts">
	import { IconTerminal } from "@tabler/icons-svelte";

	export interface AgentInputSlashCommand {
		name: string;
		description: string;
		input?: {
			hint: string;
		} | null;
	}

	interface Props {
		commands: ReadonlyArray<AgentInputSlashCommand>;
		isOpen: boolean;
		query: string;
		position: { top: number; left: number };
		headerLabel?: string;
		noCommandsLabel?: string;
		noResultsLabel?: string;
		startTypingLabel?: string;
		selectHintLabel?: string;
		closeHintLabel?: string;
		onSelect: (command: AgentInputSlashCommand) => void;
		onClose: () => void;
	}

	const MAX_SLASH_COMMAND_RESULTS = 20;

	let {
		commands,
		isOpen,
		query,
		position,
		headerLabel = "Commands",
		noCommandsLabel = "No commands available",
		noResultsLabel = "No matching commands",
		startTypingLabel = "Start typing to filter commands",
		selectHintLabel = "Select",
		closeHintLabel = "Close",
		onSelect,
		onClose,
	}: Props = $props();

	let selectedIndex = $state(0);
	let itemRefs = $state<Record<number, HTMLDivElement>>({});

	function portalToBody(node: HTMLElement): { destroy: () => void } {
		document.body.appendChild(node);

		return {
			destroy(): void {
				node.remove();
			},
		};
	}

	const filteredCommands = $derived.by(() => {
		if (!query || !query.trim()) {
			return commands.slice(0, MAX_SLASH_COMMAND_RESULTS);
		}

		const lowerQuery = query.toLowerCase().trim();
		return commands
			.filter((command) => command.name.toLowerCase().includes(lowerQuery))
			.slice(0, MAX_SLASH_COMMAND_RESULTS);
	});

	const effectiveSelectedIndex = $derived.by(() => {
		if (filteredCommands.length === 0) {
			return 0;
		}

		return Math.max(0, Math.min(selectedIndex, filteredCommands.length - 1));
	});

	function scrollSelectedIntoView(): void {
		const item = itemRefs[effectiveSelectedIndex];
		if (item) {
			item.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}

	export function handleKeyDown(event: KeyboardEvent): boolean {
		if (!isOpen) {
			return false;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			selectedIndex =
				filteredCommands.length === 0
					? 0
					: (effectiveSelectedIndex + 1) % filteredCommands.length;
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			selectedIndex =
				filteredCommands.length === 0
					? 0
					: effectiveSelectedIndex <= 0
						? filteredCommands.length - 1
						: effectiveSelectedIndex - 1;
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "Enter" || event.key === "Tab") {
			if (filteredCommands.length > 0) {
				event.preventDefault();
				onSelect(filteredCommands[effectiveSelectedIndex]);
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
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portalToBody
		class="fixed z-[var(--overlay-z)] w-80 overflow-hidden rounded-lg border bg-popover shadow-lg"
		style="top: {position.top}px; left: {position.left}px; transform: translateY(-100%); margin-top: -8px;"
		onmousedown={(event) => event.preventDefault()}
	>
		{#if filteredCommands.length > 0}
			<div class="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 shrink-0">
				<span class="text-sm font-medium text-muted-foreground">{headerLabel}</span>
				<span class="text-sm tabular-nums text-muted-foreground">{filteredCommands.length}</span>
			</div>

			<div class="flex max-h-64 flex-col overflow-y-auto">
				{#each filteredCommands as command, index (`${command.name}-${index}`)}
					{@const isSelected = index === effectiveSelectedIndex}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						bind:this={itemRefs[index]}
						class="flex cursor-pointer items-center gap-2 min-w-0 px-3 py-2 {isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
						title={command.description}
						onclick={() => onSelect(command)}
						onmouseenter={() => {
							selectedIndex = index;
						}}
					>
						<IconTerminal
							class="h-3.5 w-3.5 shrink-0 {isSelected ? 'text-accent-foreground' : 'text-muted-foreground'}"
						/>
						<span class="min-w-0 truncate font-mono text-sm leading-none">/{command.name}</span>
					</div>
				{/each}
			</div>

			<div class="flex items-center gap-2 border-t bg-muted/30 px-3 py-1 shrink-0">
				<kbd class="rounded border bg-muted px-1 py-0.5 text-sm font-medium">Enter</kbd>
				<span class="text-sm text-muted-foreground">{selectHintLabel}</span>
				<kbd class="ml-1.5 rounded border bg-muted px-1 py-0.5 text-sm font-medium">Esc</kbd>
				<span class="text-sm text-muted-foreground">{closeHintLabel}</span>
			</div>
		{:else if commands.length === 0}
			<div class="px-3 py-4 text-center text-sm text-muted-foreground">{noCommandsLabel}</div>
		{:else if query.length > 0}
			<div class="px-3 py-4 text-center text-sm text-muted-foreground">{noResultsLabel}</div>
		{:else}
			<div class="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 shrink-0">
				<span class="text-sm font-medium text-muted-foreground">{headerLabel}</span>
			</div>
			<div class="px-3 py-4 text-center text-sm text-muted-foreground">{startTypingLabel}</div>
		{/if}
	</div>
{/if}
