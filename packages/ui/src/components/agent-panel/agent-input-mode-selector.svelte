<!--
  AgentInputModeSelector - Labeled mode dropdown (plan/build/auto) in the composer toolbar.

  State and registry stay in desktop. Component accepts the current state and callbacks.
-->
<script lang="ts">
	import { CaretDown, Check, Robot } from "phosphor-svelte";

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
		autoDescription?: string;
		autonomousActive?: boolean;
		autoDisabled?: boolean;
		autoDisabledReason?: string | null;
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
		autoDescription = "Keep going automatically.",
		autonomousActive = false,
		autoDisabled = false,
		autoDisabledReason = null,
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
		if (modeId === autoModeId) return autoDescription;
		return null;
	}

	const buildMode = $derived(
		availableModes.find((mode) => mode.id === buildModeId) ?? null
	);
	const modeOptions = $derived.by((): readonly ModeDropdownOption[] => {
		const baseOptions = availableModes.map((mode) => {
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

		if (!buildMode) {
			return baseOptions;
		}

		return [
			...baseOptions,
			{
				id: autoModeId,
				label: autoLabel,
				description: defaultDescription(autoModeId),
				disabled: autoDisabled,
			},
		];
	});
	const selectedOption = $derived.by(() => {
		const selectedId = autonomousActive ? autoModeId : currentModeId;
		return (
			modeOptions.find((option) => option.id === selectedId) ??
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
			<button
				{...props}
				type="button"
				class="flex h-7 w-7 items-center justify-center rounded-none text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
			</button>
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
					{:else if option.id === autoModeId}
						<Robot
							class="mt-0.5 size-3 shrink-0 self-start"
							style={`color: ${modeColor(option.id)}`}
							weight={selected ? "fill" : "regular"}
						/>
					{:else}
						<BuildIcon size="sm" class="mt-0.5 self-start" style={`color: ${modeColor(option.id)}`} />
					{/if}
					<div class="flex min-w-0 flex-1 flex-col">
						<span class="text-[12px] font-medium">{option.label}</span>
						{#if option.description}
							<span class="text-[10px] leading-[1.25] text-muted-foreground">{option.description}</span>
						{/if}
						{#if option.id === autoModeId && autoDisabled && autoDisabledReason}
							<span class="text-[10px] leading-[1.25] text-muted-foreground">
								{autoDisabledReason}
							</span>
						{/if}
					</div>
				</div>
			</DropdownMenu.Item>
		{/each}
	</DropdownMenu.Content>
</DropdownMenu.Root>
