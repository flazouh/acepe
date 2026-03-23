<script lang="ts">
import { portal } from "../../actions/portal.js";
import type { AvailableCommand } from "../../types/available-command.js";
import CommandsList from "./components/commands-list.svelte";
import EmptyStates from "./components/empty-states.svelte";
import Footer from "./components/footer.svelte";
import Header from "./components/header.svelte";
import { filterCommands } from "./logic/command-filter.js";
import { SlashCommandDropdownState } from "./state/slash-command-dropdown-state.svelte.js";
import type { SlashCommandDropdownProps } from "./types/slash-command-dropdown-props.js";

// Keep props as reactive object instead of destructuring
const props: SlashCommandDropdownProps = $props();

// Create state instance (only manages local UI state)
const state = new SlashCommandDropdownState();

// Filtered commands derived from reactive props
const filteredCommands = $derived.by(() => {
	return filterCommands(props.commands, props.query);
});

// Reset selection when filtered commands change
$effect(() => {
	// Track filteredCommands length to trigger reset when list changes
	if (filteredCommands.length >= 0) {
		state.resetSelection();
	}
});

// Expose handleKeyDown for parent component
export function handleKeyDown(event: KeyboardEvent): boolean {
	return state.handleKeyDown(event, props.isOpen, filteredCommands, props.onSelect, props.onClose);
}
</script>

{#if props.isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		class="fixed z-[100] w-80 rounded-lg border bg-popover shadow-lg overflow-hidden"
		style="top: {props.position.top}px; left: {props.position
			.left}px; transform: translateY(-100%); margin-top: -8px;"
		onmousedown={(e) => e.preventDefault()}
	>
		{#if filteredCommands.length > 0}
			<Header count={filteredCommands.length} />
			<CommandsList
				commands={filteredCommands}
				selectedIndex={state.selectedIndex}
				bind:itemRefs={state.itemRefs}
				onSelect={(command: AvailableCommand) => state.handleItemClick(command, props.onSelect)}
				onHover={(index: number) => state.handleItemHover(index)}
			/>
			<Footer />
		{:else}
			<EmptyStates commandsCount={props.commands.length} query={props.query} />
		{/if}
	</div>
{/if}
