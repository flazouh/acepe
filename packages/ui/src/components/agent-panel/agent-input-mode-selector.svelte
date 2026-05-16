<!--
  AgentInputModeSelector - Labeled mode dropdown (plan/build/auto) in the composer toolbar.

  State and registry stay in desktop. Component accepts the current state and callbacks.
-->
<script lang="ts">
	import { CaretDown, Check, Robot } from "phosphor-svelte";

	import { Button } from "../button/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { BuildIcon, PlanIcon } from "../icons/index.js";
	import { Colors } from "../../lib/colors.js";

	export interface AgentInputMode {
		id: string;
		label?: string;
		description?: string | null;
	}

	interface Props {
		availableModes: readonly AgentInputMode[];
		currentModeId: string | null;
		planModeId?: string;
		buildModeId?: string;
		autoModeId?: string;
		planLabel?: string;
		buildLabel?: string;
		autoLabel?: string;
		planDescription?: string;
		buildDescription?: string;
		autonomousActive?: boolean;
		onModeChange: (modeId: string) => void;
	}

	let {
		availableModes,
		currentModeId,
		planModeId = "plan",
		buildModeId = "build",
		autoModeId = "auto",
		planLabel = "Plan",
		buildLabel = "Build",
		autoLabel = "Auto",
		planDescription = "Think first.",
		buildDescription = "Edit directly.",
		autonomousActive = false,
		onModeChange,
	}: Props = $props();

	let menuOpen = $state(false);

	type ModeDropdownOption = {
		id: string;
		label: string;
		description?: string | null;
		disabled?: boolean;
	};

	function modeColor(modeId: string): string {
		if (modeId === buildModeId) return "var(--build-icon)";
		if (modeId === planModeId) return "var(--plan-icon)";
		if (modeId === autoModeId) return Colors.purple;
		return "currentColor";
	}

	function handleModeChange(modeId: string) {
		const selectedId = autonomousActive ? autoModeId : currentModeId;
		if (modeId !== selectedId) {
			onModeChange(modeId);
		}
	}

	function defaultDescription(modeId: string): string | null {
		if (modeId === planModeId) return planDescription;
		if (modeId === buildModeId) return buildDescription;
		return null;
	}

	const modeOptions = $derived.by((): readonly ModeDropdownOption[] => {
		return availableModes.map((mode) => {
			if (mode.id === planModeId) {
				return {
					id: mode.id,
					label: mode.label ?? planLabel,
					description: mode.description ?? defaultDescription(mode.id),
				};
			}

			if (mode.id === buildModeId) {
				return {
					id: mode.id,
					label: mode.label ?? buildLabel,
					description: mode.description ?? defaultDescription(mode.id),
				};
			}

			return {
				id: mode.id,
				label: mode.label ?? mode.id,
				description: mode.description ?? defaultDescription(mode.id),
			};
		});
	});
	const selectedOption = $derived.by(() => {
		// When autonomous is active, show the auto indicator in the trigger even
		// though auto is not a selectable item in the dropdown.
		if (autonomousActive) {
			return { id: autoModeId, label: autoLabel, description: null };
		}
		return (
			modeOptions.find((option) => option.id === currentModeId) ??
			modeOptions[0] ?? {
				id: buildModeId,
				label: buildLabel,
			}
		);
	});
</script>

<DropdownMenu.Root bind:open={menuOpen}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				type="button"
				variant="outline"
				size="sm"
				class="h-7 w-7 shrink-0 cursor-pointer rounded-none border-0 p-0 text-muted-foreground"
				aria-label={selectedOption.label}
				title={selectedOption.label}
			>
				{#if selectedOption.id === planModeId}
					<PlanIcon
						size="sm"
						class="transition-colors duration-150"
						style={`color: ${modeColor(planModeId)}`}
					/>
				{:else if selectedOption.id === autoModeId}
					<Robot
						class="size-3 shrink-0 transition-colors duration-150"
						style={`color: ${modeColor(autoModeId)}`}
						weight="fill"
					/>
				{:else}
					<BuildIcon
						size="sm"
						class="transition-colors duration-150"
						style={`color: ${modeColor(buildModeId)}`}
					/>
				{/if}
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>

	<DropdownMenu.Content align="start" side="top" sideOffset={8} class="w-[188px]">
		{#each modeOptions as option (option.id)}
			{@const selected = option.id === selectedOption.id}
			<DropdownMenu.Item
				disabled={option.disabled}
				onSelect={() => handleModeChange(option.id)}
				class="cursor-pointer text-[0.75rem]"
			>
				<div class="flex w-full items-start gap-2">
					<Check
						class={selected
							? "mt-0.5 size-3 shrink-0 self-start text-foreground"
							: "mt-0.5 size-3 shrink-0 self-start text-transparent"}
						weight="bold"
					/>
					{#if option.id === planModeId}
						<PlanIcon size="sm" class="mt-0.5 self-start" style={`color: ${modeColor(option.id)}`} />
					{:else}
						<BuildIcon size="sm" class="mt-0.5 self-start" style={`color: ${modeColor(option.id)}`} />
					{/if}
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="text-xs font-medium">{option.label}</span>
						{#if option.description}
							<span class="text-[11px] leading-[1.25] text-muted-foreground">{option.description}</span>
						{/if}
					</div>
				</div>
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
