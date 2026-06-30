<!--
  AgentInputModeSelector - Provider mode dropdown in the composer toolbar.

  State and registry stay in desktop. Component accepts the current state and callbacks.
-->
<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { Selector } from "../selector/index.js";
	import {
		getModeDropdownOptions,
		getSelectedModeOption,
		shouldEmitModeChange,
		type AgentInputMode,
		type ModeIconKind,
	} from "./agent-input-mode-selector-state.js";
	export type { AgentInputMode, ModeIconKind } from "./agent-input-mode-selector-state.js";

	interface Props {
		availableModes: readonly AgentInputMode[];
		currentModeId: string | null;
		disabled?: boolean;
		autonomousActive?: boolean;
		onModeChange: (modeId: string) => void;
	}

	let {
		availableModes,
		currentModeId,
		disabled = false,
		autonomousActive = false,
		onModeChange,
	}: Props = $props();

	let menuOpen = $state(false);

	function handleModeChange(modeId: string) {
		if (shouldEmitModeChange({ nextModeId: modeId, currentModeId })) {
			onModeChange(modeId);
		}
		menuOpen = false;
	}

	const modeOptions = $derived(getModeDropdownOptions(availableModes));
	const selectedOption = $derived(
		getSelectedModeOption({ modeOptions, currentModeId })
	);
</script>

<Selector
	bind:open={menuOpen}
	{disabled}
	align="start"
	side="top"
	sideOffset={8}
	variant="outline"
	showChevron={false}
	triggerAriaLabel={selectedOption.label}
>
	{#snippet renderButton()}
		<span class="min-w-0 truncate text-xs">{selectedOption.label}</span>
	{/snippet}

	{#each modeOptions as option (option.id)}
		{@const selected = option.id === selectedOption.id}
		<DropdownMenu.Item
			disabled={option.disabled}
			onSelect={() => handleModeChange(option.id)}
			class="cursor-pointer rounded-md border-b-0 px-1.5 py-1.5 text-[0.75rem]"
		>
			<div class="flex w-full items-start gap-1.5">
				<div class="flex min-w-0 flex-1 flex-col">
					<span class="text-xs font-medium">{option.label}</span>
					{#if option.description}
						<span class="text-[11px] leading-[1.25] text-muted-foreground">{option.description}</span>
					{/if}
				</div>
				<RoundedIcon
					name="check-circle"
					class={selected
						? "mt-0.5 size-3.5 shrink-0 self-start text-foreground"
						: "mt-0.5 size-3.5 shrink-0 self-start text-transparent"}
				/>
			</div>
		</DropdownMenu.Item>
	{/each}
</Selector>
