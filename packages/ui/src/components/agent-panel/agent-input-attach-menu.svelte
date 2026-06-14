<!--
  AgentInputAttachMenu - + button popover for modes, context, skills, and overflow controls.
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { IconPlus } from "@tabler/icons-svelte";
	import { CheckCircle, File, Image as ImageIcon } from "phosphor-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Selector } from "../selector/index.js";
	import AgentInputModeIcon from "./agent-input-mode-icon.svelte";
	import AgentInputAutonomousToggle from "./agent-input-autonomous-toggle.svelte";
	import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
	import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";
	import {
		filterAttachMenuItems,
		type AttachMenuCommandItem,
		type AttachMenuModeItem,
	} from "./agent-input-attach-menu-state.js";

	interface Props {
		disabled?: boolean;
		searchPlaceholder?: string;
		modes?: readonly AttachMenuModeItem[];
		commands?: readonly AttachMenuCommandItem[];
		showModes?: boolean;
		showContextActions?: boolean;
		addFileContextLabel?: string;
		attachImageLabel?: string;
		skillsSubmenuLabel?: string;
		modesGroupLabel?: string;
		overflow?: Snippet;
		autonomousToggleActive?: boolean;
		autonomousDisabled?: boolean;
		autonomousBusy?: boolean;
		autonomousTooltip?: string;
		onAutonomousToggle?: () => void;
		toolbarConfigOptions?: readonly AgentInputConfigOption[];
		configOptionsDisabled?: boolean;
		onConfigOptionChange?: (configId: string, value: string) => void | Promise<void>;
		onModeChange?: (modeId: string) => void;
		onAddFileContext?: () => void;
		onAttachImage?: () => void;
		onCommandSelect?: (commandId: string) => void;
	}

	let {
		disabled = false,
		searchPlaceholder = "Add context, tools…",
		modes = [],
		commands = [],
		showModes = true,
		showContextActions = true,
		addFileContextLabel = "Add file context",
		attachImageLabel = "Attach image",
		skillsSubmenuLabel = "Skills",
		modesGroupLabel = "Modes",
		overflow,
		autonomousToggleActive = false,
		autonomousDisabled = false,
		autonomousBusy = false,
		autonomousTooltip,
		onAutonomousToggle,
		toolbarConfigOptions = [],
		configOptionsDisabled = false,
		onConfigOptionChange,
		onModeChange,
		onAddFileContext,
		onAttachImage,
		onCommandSelect,
	}: Props = $props();

	let menuOpen = $state(false);
	let searchQuery = $state("");

	const filteredItems = $derived(
		filterAttachMenuItems({
			query: searchQuery,
			modes: showModes ? modes : [],
			commands,
		})
	);

	function handleOpenChange(open: boolean): void {
		menuOpen = open;
		if (!open) {
			searchQuery = "";
		}
	}

	function handleModeSelect(modeId: string): void {
		onModeChange?.(modeId);
		menuOpen = false;
		searchQuery = "";
	}

	function handleAddFileContext(): void {
		onAddFileContext?.();
		menuOpen = false;
		searchQuery = "";
	}

	function handleAttachImage(): void {
		onAttachImage?.();
		menuOpen = false;
		searchQuery = "";
	}

	function handleCommandSelect(commandId: string): void {
		onCommandSelect?.(commandId);
		menuOpen = false;
		searchQuery = "";
	}
</script>

<Selector
	bind:open={menuOpen}
	{disabled}
	onOpenChange={handleOpenChange}
	align="start"
	side="top"
	sideOffset={8}
	variant="headerAction"
	showChevron={false}
	triggerSize="attach"
	triggerAriaLabel="Add context and tools"
>
	{#snippet renderButton()}
		<IconPlus class="size-3.5" />
	{/snippet}

	<div class="px-1 pb-1">
			<input
				type="search"
				bind:value={searchQuery}
				placeholder={searchPlaceholder}
				class="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
				aria-label={searchPlaceholder}
			/>
		</div>

		{#if showModes && filteredItems.modes.length > 0}
			<DropdownMenu.Label class="px-2 py-1 text-[11px] text-muted-foreground">
				{modesGroupLabel}
			</DropdownMenu.Label>
			{#each filteredItems.modes as mode (mode.id)}
				<DropdownMenu.Item
					disabled={mode.disabled}
					onSelect={() => handleModeSelect(mode.id)}
					class="cursor-pointer rounded-md px-1.5 py-1.5"
				>
					<div class="flex w-full items-start gap-1.5">
						<AgentInputModeIcon iconKind={mode.iconKind} class="mt-0.5 size-3 shrink-0 self-start" />
						<div class="flex min-w-0 flex-1 flex-col">
							<span class="text-xs font-medium">{mode.label}</span>
							{#if mode.description}
								<span class="text-[11px] leading-[1.25] text-muted-foreground">{mode.description}</span>
							{/if}
						</div>
						<CheckCircle
							class={mode.selected
								? "mt-0.5 size-3.5 shrink-0 self-start text-foreground"
								: "mt-0.5 size-3.5 shrink-0 self-start text-transparent"}
							weight="fill"
						/>
					</div>
				</DropdownMenu.Item>
			{/each}
		{/if}

		{#if showContextActions && searchQuery.length === 0}
			<DropdownMenu.Separator />
			<DropdownMenu.Item onSelect={handleAddFileContext} class="cursor-pointer rounded-md px-2 py-1.5">
				<File class="size-3.5 shrink-0" />
				<span class="text-xs">{addFileContextLabel}</span>
			</DropdownMenu.Item>
			<DropdownMenu.Item onSelect={handleAttachImage} class="cursor-pointer rounded-md px-2 py-1.5">
				<ImageIcon class="size-3.5 shrink-0" />
				<span class="text-xs">{attachImageLabel}</span>
			</DropdownMenu.Item>
		{/if}

		{#if filteredItems.commands.length > 0}
			<DropdownMenu.Separator />
			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger class="cursor-pointer rounded-md px-2 py-1.5 text-xs">
					{skillsSubmenuLabel}
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent class="max-h-64 w-[240px]">
					{#each filteredItems.commands as command (command.id)}
						<DropdownMenu.Item
							onSelect={() => handleCommandSelect(command.id)}
							class="cursor-pointer rounded-md px-2 py-1.5"
						>
							<div class="flex min-w-0 flex-col">
								<span class="truncate text-xs font-medium">{command.label}</span>
								{#if command.description}
									<span class="truncate text-[11px] text-muted-foreground">{command.description}</span>
								{/if}
							</div>
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.SubContent>
			</DropdownMenu.Sub>
		{/if}

		{#if searchQuery.length === 0 && (onAutonomousToggle || toolbarConfigOptions.length > 0)}
			<DropdownMenu.Separator />
			{#if onAutonomousToggle}
				<div class="flex items-center justify-between px-2 py-1.5">
					<span class="text-xs text-muted-foreground">Autonomous</span>
					<AgentInputAutonomousToggle
						active={autonomousToggleActive}
						disabled={autonomousDisabled}
						busy={autonomousBusy}
						title={autonomousTooltip ?? "Autonomous"}
						ariaLabel={autonomousTooltip ?? "Autonomous"}
						tooltipDescription="Skip permission prompts and let the agent run tools automatically."
						onToggle={onAutonomousToggle}
					/>
				</div>
			{/if}
			{#if toolbarConfigOptions.length > 0}
				<div class="flex flex-col gap-0.5 px-1 py-1">
					{#each toolbarConfigOptions as configOption (configOption.id)}
						<AgentInputConfigOptionSelector
							{configOption}
							disabled={configOptionsDisabled}
							onValueChange={(configId, value) => {
								void onConfigOptionChange?.(configId, value);
							}}
						/>
					{/each}
				</div>
			{/if}
		{/if}

		{#if overflow && searchQuery.length === 0}
			<DropdownMenu.Separator />
		{@render overflow()}
	{/if}
</Selector>
