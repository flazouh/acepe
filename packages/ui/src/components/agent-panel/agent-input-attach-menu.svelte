<!--
  AgentInputAttachMenu - + button popover for modes, context, skills, and MCP.
-->
<script lang="ts">
	import type { Snippet } from "svelte";
	import { CheckCircle, File, Image as ImageIcon, Plus } from "phosphor-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { EmbeddedIconButton } from "../panel-header/index.js";
	import AgentInputModeIcon from "./agent-input-mode-icon.svelte";
	import AgentInputAutonomousToggle from "./agent-input-autonomous-toggle.svelte";
	import AgentInputSlashCommandRow from "./agent-input-slash-command-row.svelte";
	import AgentInputMcpServerGroup from "./agent-input-mcp-server-group.svelte";
	import {
		filterAttachMenuItems,
		type AttachMenuCommandItem,
		type AttachMenuCommandSection,
		type AttachMenuMcpServerGroup,
		type AttachMenuModeItem,
	} from "./agent-input-attach-menu-state.js";

	interface Props {
		disabled?: boolean;
		searchPlaceholder?: string;
		modes?: readonly AttachMenuModeItem[];
		commandSections?: readonly AttachMenuCommandSection[];
		mcpServerGroups?: readonly AttachMenuMcpServerGroup[];
		mcpLoading?: boolean;
		showMcpSection?: boolean;
		mcpCatalogLoaded?: boolean;
		mcpEmptyLabel?: string;
		showModes?: boolean;
		showContextActions?: boolean;
		addFileContextLabel?: string;
		attachImageLabel?: string;
		mcpSectionLabel?: string;
		checkpointOverflow?: Snippet;
		autonomousToggleActive?: boolean;
		autonomousDisabled?: boolean;
		autonomousBusy?: boolean;
		autonomousTooltip?: string;
		onAutonomousToggle?: () => void;
		onModeChange?: (modeId: string) => void;
		onAddFileContext?: () => void;
		onAttachImage?: () => void;
		onCommandItemSelect?: (item: AttachMenuCommandItem) => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		disabled = false,
		searchPlaceholder = "Add context, tools…",
		modes = [],
		commandSections = [],
		mcpServerGroups = [],
		mcpLoading = false,
		showMcpSection = false,
		mcpCatalogLoaded = false,
		mcpEmptyLabel = "No MCP servers configured for this project",
		showModes = true,
		showContextActions = true,
		addFileContextLabel = "Add file context",
		attachImageLabel = "Attach image",
		mcpSectionLabel = "MCP",
		checkpointOverflow,
		autonomousToggleActive = false,
		autonomousDisabled = false,
		autonomousBusy = false,
		autonomousTooltip,
		onAutonomousToggle,
		onModeChange,
		onAddFileContext,
		onAttachImage,
		onCommandItemSelect,
		onOpenChange,
	}: Props = $props();

	let menuOpen = $state(false);
	let searchQuery = $state("");
	let collapsedMcpServers = $state<Set<string>>(new Set());

	const filteredItems = $derived(
		filterAttachMenuItems({
			query: searchQuery,
			modes: showModes ? modes : [],
			commandSections,
			mcpServerGroups,
		})
	);

	const hasCommandContent = $derived(
		filteredItems.commandSections.length > 0 ||
			showMcpSection ||
			searchQuery.trim().length > 0
	);

	const skillsSection = $derived(
		filteredItems.commandSections.find((section) => section.id === "skills") ?? null
	);
	const commandsSection = $derived(
		filteredItems.commandSections.find((section) => section.id === "commands") ?? null
	);
	const flattenedSearchItems = $derived.by(() => {
		if (searchQuery.trim().length === 0) {
			return [] as AttachMenuCommandItem[];
		}
		const items: AttachMenuCommandItem[] = [];
		for (const section of filteredItems.commandSections) {
			for (const item of section.items) {
				items.push(item);
			}
		}
		for (const group of filteredItems.mcpServerGroups) {
			for (const item of group.slashItems) {
				items.push(item);
			}
			for (const item of group.toolItems) {
				items.push(item);
			}
		}
		return items;
	});
	const showMcpSubmenu = $derived(showMcpSection);

	const attachSubmenuContentProps = {
		side: "right",
		align: "start",
		sideOffset: 2,
		avoidCollisions: false,
	} as const;

	const attachMenuContentClass = "w-72 max-w-[18rem] !max-h-none h-auto overflow-y-auto";
	const attachSubmenuContentClass = "w-80 max-w-[20rem] !max-h-72 h-auto overflow-y-auto p-0";

	function isMcpServerExpanded(serverId: string): boolean {
		return !collapsedMcpServers.has(serverId);
	}

	function toggleMcpServer(serverId: string): void {
		const next = new Set(collapsedMcpServers);
		if (next.has(serverId)) {
			next.delete(serverId);
		} else {
			next.add(serverId);
		}
		collapsedMcpServers = next;
	}

	function toSlashCommand(item: AttachMenuCommandItem) {
		return {
			name: item.label,
			description: item.description ?? "",
			input: null,
		};
	}

	function handleOpenChange(open: boolean): void {
		menuOpen = open;
		onOpenChange?.(open);
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

	function handleCommandItemSelect(item: AttachMenuCommandItem): void {
		onCommandItemSelect?.(item);
		menuOpen = false;
		searchQuery = "";
	}
</script>

<div class="flex items-end gap-0.5">
<DropdownMenu.Root bind:open={menuOpen} onOpenChange={handleOpenChange}>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<EmbeddedIconButton
				{...props}
				{disabled}
				active={menuOpen}
				title="Add context and tools"
				ariaLabel="Add context and tools"
			>
				{#snippet children()}
					<Plus size={12} weight="bold" />
				{/snippet}
			</EmbeddedIconButton>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content side="top" align="start" sideOffset={8} class={attachMenuContentClass}>
	<div class="flex h-auto flex-col gap-0 pb-0">
	<div class="px-1.5 pb-0.5 pt-0">
			<input
				type="search"
				bind:value={searchQuery}
				placeholder={searchPlaceholder}
				class="h-5 w-full border-none bg-transparent px-0 py-0 text-[11px] leading-tight text-foreground shadow-none outline-none ring-0 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-0 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
				aria-label={searchPlaceholder}
				autocomplete="off"
				spellcheck={false}
			/>
		</div>

		{#if showModes && filteredItems.modes.length > 0}
			{#each filteredItems.modes as mode (mode.id)}
				<DropdownMenu.Item
					disabled={mode.disabled}
					onSelect={() => handleModeSelect(mode.id)}
					class="cursor-pointer"
				>
					<AgentInputModeIcon iconKind={mode.iconKind} class="size-3.5 shrink-0" monochrome />
					<span class="min-w-0 flex-1 truncate text-xs">{mode.label}</span>
					<CheckCircle
						class={mode.selected
							? "size-3.5 shrink-0 text-foreground"
							: "size-3.5 shrink-0 text-transparent"}
						weight="fill"
					/>
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

		{#if hasCommandContent}
			<DropdownMenu.Separator />
			{#if searchQuery.trim().length > 0}
				<div class="max-h-72 overflow-y-auto py-1">
					{#each flattenedSearchItems as item (item.id)}
						<AgentInputSlashCommandRow
							command={toSlashCommand(item)}
							tokenType={item.tokenType}
							onSelect={() => handleCommandItemSelect(item)}
						/>
					{/each}
					{#if flattenedSearchItems.length === 0}
						<div class="px-2.5 py-2 text-center text-[11px] text-muted-foreground">
							No matching skills or MCP tools
						</div>
					{/if}
				</div>
			{:else}
				{#if skillsSection && skillsSection.items.length > 0}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class="cursor-pointer rounded-md px-2 py-1.5 text-xs">
							<span class="min-w-0 flex-1 truncate">{skillsSection.label}</span>
							<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
								{skillsSection.items.length}
							</span>
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent
							class={attachSubmenuContentClass}
							side={attachSubmenuContentProps.side}
							align={attachSubmenuContentProps.align}
							sideOffset={attachSubmenuContentProps.sideOffset}
							avoidCollisions={attachSubmenuContentProps.avoidCollisions}
						>
							<div class="flex max-h-72 flex-col overflow-y-auto py-1">
								{#each skillsSection.items as item (item.id)}
									<AgentInputSlashCommandRow
										command={toSlashCommand(item)}
										tokenType={item.tokenType}
										onSelect={() => handleCommandItemSelect(item)}
									/>
								{/each}
							</div>
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/if}

				{#if commandsSection && commandsSection.items.length > 0}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class="cursor-pointer rounded-md px-2 py-1.5 text-xs">
							<span class="min-w-0 flex-1 truncate">{commandsSection.label}</span>
							<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
								{commandsSection.items.length}
							</span>
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent
							class={attachSubmenuContentClass}
							side={attachSubmenuContentProps.side}
							align={attachSubmenuContentProps.align}
							sideOffset={attachSubmenuContentProps.sideOffset}
							avoidCollisions={attachSubmenuContentProps.avoidCollisions}
						>
							<div class="flex max-h-72 flex-col overflow-y-auto py-1">
								{#each commandsSection.items as item (item.id)}
									<AgentInputSlashCommandRow
										command={toSlashCommand(item)}
										tokenType={item.tokenType}
										onSelect={() => handleCommandItemSelect(item)}
									/>
								{/each}
							</div>
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/if}

				{#if showMcpSubmenu}
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger class="cursor-pointer rounded-md px-2 py-1.5 text-xs">
							<span class="min-w-0 flex-1 truncate">{mcpSectionLabel}</span>
							<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
								{#if mcpLoading}
									…
								{:else if filteredItems.mcpServerGroups.length > 0}
									{filteredItems.mcpServerGroups.length}
								{:else if mcpCatalogLoaded}
									0
								{:else}
									…
								{/if}
							</span>
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent
							class={attachSubmenuContentClass}
							side={attachSubmenuContentProps.side}
							align={attachSubmenuContentProps.align}
							sideOffset={attachSubmenuContentProps.sideOffset}
							avoidCollisions={attachSubmenuContentProps.avoidCollisions}
						>
							<div class="max-h-72 overflow-y-auto">
								{#if mcpLoading && filteredItems.mcpServerGroups.length === 0}
									<div class="px-2.5 py-2 text-[11px] text-muted-foreground">
										Loading MCP servers…
									</div>
								{:else if filteredItems.mcpServerGroups.length === 0}
									<div class="px-2.5 py-2 text-[11px] text-muted-foreground">
										{mcpEmptyLabel}
									</div>
								{/if}
								{#each filteredItems.mcpServerGroups as group (group.id)}
									<AgentInputMcpServerGroup
										id={group.id}
										name={group.name}
										status={group.status}
										error={group.error}
										slashItems={group.slashItems}
										toolItems={group.toolItems}
										expanded={isMcpServerExpanded(group.id)}
										onToggle={() => toggleMcpServer(group.id)}
										onItemSelect={handleCommandItemSelect}
									/>
								{/each}
							</div>
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
				{/if}
			{/if}
		{/if}

		{#if checkpointOverflow}
			<DropdownMenu.Separator />
			<div class="px-2 py-1">
				{@render checkpointOverflow()}
			</div>
		{/if}
	</div>
	</DropdownMenu.Content>
</DropdownMenu.Root>
{#if onAutonomousToggle}
	<AgentInputAutonomousToggle
		active={autonomousToggleActive}
		disabled={autonomousDisabled || disabled}
		busy={autonomousBusy}
		title={autonomousTooltip ?? "Auto-approve"}
		ariaLabel={autonomousTooltip ?? "Auto-approve"}
		tooltipDescription="Acepe auto-approves every permission request — file edits, commands, and other actions — without asking. Questions and plan reviews still surface."
		onToggle={onAutonomousToggle}
	/>
{/if}
</div>
