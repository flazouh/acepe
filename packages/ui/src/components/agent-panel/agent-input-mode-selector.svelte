<!--
  AgentInputModeSelector - Provider mode dropdown in the composer toolbar.

  State and registry stay in desktop. Component accepts the current state and callbacks.
-->
<script lang="ts">
	import {
		ChatCircle,
		CheckCircle,
		Lightning,
		ListChecks,
		PencilSimple,
		Question,
		Robot,
		SealQuestion,
		ShieldCheck,
	} from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import {
		getModeDropdownOptions,
		getModeIconColor,
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
	}

	const modeOptions = $derived(getModeDropdownOptions(availableModes));
	const selectedOption = $derived(
		getSelectedModeOption({ modeOptions, currentModeId })
	);
</script>

{#snippet modeIcon(iconKind: ModeIconKind, className: string)}
	{#if iconKind === "agent"}
		<Robot class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{:else if iconKind === "plan"}
		<ListChecks class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{:else if iconKind === "autonomous"}
		<Lightning class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{:else if iconKind === "bypass"}
		<ShieldCheck class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{:else if iconKind === "ask"}
		<ChatCircle class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{:else if iconKind === "edit"}
		<PencilSimple class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{:else if iconKind === "review"}
		<SealQuestion class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{:else}
		<Question class={className} weight="fill" style={`color: ${getModeIconColor(iconKind)}`} />
	{/if}
{/snippet}

<DropdownMenu.Root bind:open={menuOpen}>
	<DropdownMenu.Trigger disabled={disabled}>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled}
				class="h-7 max-w-40 shrink-0 cursor-pointer gap-1 rounded-none border-0 px-1.5 text-muted-foreground has-[>svg]:px-1.5"
				aria-label={selectedOption.label}
				title={selectedOption.label}
			>
				{@render modeIcon(selectedOption.iconKind, "size-3.5 shrink-0")}
				<span class="min-w-0 truncate text-xs">{selectedOption.label}</span>
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content align="start" side="top" sideOffset={8} class="w-[220px]">
		{#each modeOptions as option (option.id)}
			{@const selected = option.id === selectedOption.id}
			<DropdownMenu.Item
				disabled={option.disabled}
				onSelect={() => handleModeChange(option.id)}
				class="cursor-pointer rounded-md border-b-0 px-1.5 py-1.5 text-[0.75rem]"
			>
				<div class="flex w-full items-start gap-1.5">
					{@render modeIcon(option.iconKind, "mt-0.5 size-3 shrink-0 self-start")}
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="text-xs font-medium">{option.label}</span>
						{#if option.description}
							<span class="text-[11px] leading-[1.25] text-muted-foreground">{option.description}</span>
						{/if}
					</div>
					<CheckCircle
						class={selected
							? "mt-0.5 size-3.5 shrink-0 self-start text-foreground"
							: "mt-0.5 size-3.5 shrink-0 self-start text-transparent"}
						weight="fill"
					/>
				</div>
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
