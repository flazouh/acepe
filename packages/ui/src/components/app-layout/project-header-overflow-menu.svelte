<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import * as Popover from "../popover/index.js";
	import { Button } from "../button/index.js";
	import { HugeiconsIcon, type HugeiconsIconName } from "../icons/index.js";
	import { Selector, SelectorItem } from "../selector/index.js";
	import { Switch } from "../switch/index.js";
	import { dropdownMenuItemRadiusClass } from "../dropdown-menu/dropdown-menu-item.classes.js";
	import { dropdownMenuItemTypographyClass } from "../dropdown-menu/dropdown-menu-typography.js";
	import { PROJECT_COLOR_OPTIONS } from "./project-color-options.js";
	import ProjectColorSwatch from "./project-color-swatch.svelte";
	import { buildProjectHeaderOverflowMenuState } from "./project-menu-state.js";

	type ProjectMenuContentWidth = "min-w-[170px]" | "min-w-[190px]" | "min-w-[220px]";

	type ProjectMenuActionEntry = {
		readonly kind: "action";
		readonly id: string;
		readonly label: string;
		readonly icon: HugeiconsIconName;
		readonly iconClass?: string;
		readonly disabled?: boolean;
		readonly destructive?: boolean;
		readonly onSelect: () => void;
	};

	type ProjectMenuToggleEntry = {
		readonly kind: "toggle";
		readonly id: string;
		readonly label: string;
		readonly icon: HugeiconsIconName;
		readonly checked: boolean;
		readonly onToggle: (checked: boolean) => void;
	};

	type ProjectMenuColorEntry = {
		readonly kind: "color-submenu";
		readonly id: string;
		readonly label: string;
		readonly icon: HugeiconsIconName;
	};

	type ProjectMenuEntry = ProjectMenuActionEntry | ProjectMenuToggleEntry | ProjectMenuColorEntry;

	type ProjectMenuGroup = {
		readonly id: string;
		readonly entries: readonly ProjectMenuEntry[];
	};

	type ProjectMenuSection = {
		readonly id: string;
		readonly label: string;
		readonly icon: HugeiconsIconName;
		readonly contentWidthClass: ProjectMenuContentWidth;
		readonly groups: readonly ProjectMenuGroup[];
	};

	interface Props {
		projectName: string;
		currentColor?: string;
		onColorChange?: (color: string) => void;
		projectIconSrc?: string | null;
		onResetProjectIcon?: () => void;
		onRemoveProject?: () => void;
		onMoveUp?: () => void;
		onMoveDown?: () => void;
		moveUpDisabled?: boolean;
		moveDownDisabled?: boolean;
		onChangeProjectIcon?: () => void;
		hideExternalCliSessions?: boolean;
		onHideExternalCliSessionsChange?: (hide: boolean) => void;
		hideExternalCliSessionsLabel?: string;
	}

	let {
		projectName,
		currentColor,
		onColorChange,
		projectIconSrc = null,
		onResetProjectIcon,
		onRemoveProject,
		onMoveUp,
		onMoveDown,
		moveUpDisabled = false,
		moveDownDisabled = false,
		onChangeProjectIcon,
		hideExternalCliSessions = false,
		onHideExternalCliSessionsChange,
		hideExternalCliSessionsLabel = "Hide external CLI sessions",
	}: Props = $props();

	let menuOpen = $state(false);
	let showRemoveConfirm = $state(false);
	let triggerRef: HTMLButtonElement | null = $state(null);
	const colorOptions = PROJECT_COLOR_OPTIONS;

	function handleColorSelect(colorName: string) {
		onColorChange?.(colorName);
		closeMenu();
	}

	const menuState = $derived(
		buildProjectHeaderOverflowMenuState({
			currentColor,
			colorOptions,
			projectIconSrc,
			hasColorChange: Boolean(onColorChange),
			hasResetProjectIconAction: Boolean(onResetProjectIcon),
			hasRemoveProjectAction: Boolean(onRemoveProject),
			hasChangeProjectIconAction: Boolean(onChangeProjectIcon),
		})
	);
	const hasIcon = $derived(menuState.hasIcon);
	const hasResetProjectIcon = $derived(menuState.hasResetProjectIcon);
	const showColorPicker = $derived(menuState.showColorPicker);

	const menuSections = $derived.by(() => {
		const sections: ProjectMenuSection[] = [];
		const organizeSection = createOrganizeMenuSection();
		const sessionsSection = createSessionsMenuSection();
		const appearanceSection = createAppearanceMenuSection();
		const dangerSection = createDangerMenuSection();

		if (organizeSection !== null) {
			sections.push(organizeSection);
		}
		if (sessionsSection !== null) {
			sections.push(sessionsSection);
		}
		if (appearanceSection !== null) {
			sections.push(appearanceSection);
		}
		if (dangerSection !== null) {
			sections.push(dangerSection);
		}

		return sections;
	});

	function createMenuGroup(id: string, entries: readonly ProjectMenuEntry[]): ProjectMenuGroup {
		return {
			id,
			entries,
		};
	}

	function createMenuSection(
		id: string,
		label: string,
		icon: HugeiconsIconName,
		contentWidthClass: ProjectMenuContentWidth,
		groups: readonly ProjectMenuGroup[]
	): ProjectMenuSection | null {
		const visibleGroups: ProjectMenuGroup[] = [];

		for (const group of groups) {
			if (group.entries.length > 0) {
				visibleGroups.push(group);
			}
		}

		if (visibleGroups.length === 0) {
			return null;
		}

		return {
			id,
			label,
			icon,
			contentWidthClass,
			groups: visibleGroups,
		};
	}

	function createOrganizeMenuSection(): ProjectMenuSection | null {
		const entries: ProjectMenuEntry[] = [];

		if (onMoveUp) {
			entries.push({
				kind: "action",
				id: "move-up",
				label: "Move Up",
				icon: "arrow-up",
				disabled: moveUpDisabled,
				onSelect: () => {
					onMoveUp?.();
					closeMenu();
				},
			});
		}

		if (onMoveDown) {
			entries.push({
				kind: "action",
				id: "move-down",
				label: "Move Down",
				icon: "arrow-up",
				iconClass: "shrink-0 rotate-180",
				disabled: moveDownDisabled,
				onSelect: () => {
					onMoveDown?.();
					closeMenu();
				},
			});
		}

		return createMenuSection("order", "Order", "drag", "min-w-[170px]", [
			createMenuGroup("order", entries),
		]);
	}

	function createSessionsMenuSection(): ProjectMenuSection | null {
		if (!onHideExternalCliSessionsChange) {
			return null;
		}

		return createMenuSection("visibility", "Visibility", "eye", "min-w-[220px]", [
			createMenuGroup("visibility", [
				{
					kind: "toggle",
					id: "hide-external-cli-sessions",
					label: hideExternalCliSessionsLabel,
					icon: "terminal",
					checked: hideExternalCliSessions,
					onToggle: (checked) => {
						onHideExternalCliSessionsChange?.(checked);
					},
				},
			]),
		]);
	}

	function createAppearanceMenuSection(): ProjectMenuSection | null {
		const entries: ProjectMenuEntry[] = [];

		if (onChangeProjectIcon) {
			entries.push({
				kind: "action",
				id: "change-project-icon",
				label: "Icon...",
				icon: "image",
				onSelect: () => {
					onChangeProjectIcon?.();
					closeMenu();
				},
			});
		}

		if (showColorPicker) {
			entries.push({
				kind: "color-submenu",
				id: "project-color",
				label: "Color",
				icon: "sliders",
			});
		}

		if (hasIcon && onResetProjectIcon) {
			entries.push({
				kind: "action",
				id: "reset-project-icon",
				label: "Reset to letter badge",
				icon: "avatar",
				onSelect: () => {
					onResetProjectIcon?.();
					closeMenu();
				},
			});
		}

		return createMenuSection("appearance", "Appearance", "image", "min-w-[190px]", [
			createMenuGroup("project-identity", entries),
		]);
	}

	function createDangerMenuSection(): ProjectMenuSection | null {
		if (!onRemoveProject) {
			return null;
		}

		return createMenuSection("project", "Project", "folder", "min-w-[190px]", [
			createMenuGroup("destructive", [
				{
					kind: "action",
					id: "remove-project",
					label: "Remove Project",
					icon: "trash",
					destructive: true,
					onSelect: handleRemoveClick,
				},
			]),
		]);
	}

	function handleRemoveClick() {
		menuOpen = false;
		showRemoveConfirm = true;
	}

	function closeMenu() {
		menuOpen = false;
	}

	function handleToggleRowClick(event: MouseEvent, entry: ProjectMenuToggleEntry) {
		event.stopPropagation();

		const target = event.target;
		if (target instanceof HTMLElement && target.closest("[data-slot='switch']")) {
			return;
		}

		entry.onToggle(!entry.checked);
	}
</script>

{#snippet menuItemContent(icon: HugeiconsIconName, label: string, iconClass = "shrink-0", labelClass = "")}
	{#if icon === "trash"}
		<HugeiconsIcon name="trash" class={iconClass} />
	{:else}
		<HugeiconsIcon name={icon} class={iconClass} />
	{/if}
	<span class="min-w-0 flex-1 truncate {labelClass}">{label}</span>
{/snippet}

{#snippet menuEntry(entry: ProjectMenuEntry)}
	{#if entry.kind === "action"}
		<DropdownMenu.Item
			variant={entry.destructive ? "destructive" : "default"}
			disabled={entry.disabled}
			onSelect={entry.onSelect}
		>
			{@render menuItemContent(
				entry.icon,
				entry.label,
				entry.iconClass ?? "shrink-0"
			)}
		</DropdownMenu.Item>
	{:else if entry.kind === "toggle"}
		<div
			class="relative z-10 flex cursor-default select-none items-center gap-2 {dropdownMenuItemRadiusClass} px-2 py-1 {dropdownMenuItemTypographyClass} outline-hidden transition-colors duration-75 ease-out hover:bg-accent hover:text-accent-foreground"
			role="presentation"
			onclick={(event) => handleToggleRowClick(event, entry)}
			onkeydown={(event) => event.stopPropagation()}
		>
			<HugeiconsIcon name={entry.icon} class="shrink-0 text-muted-foreground" />
			<span class="min-w-0 flex-1 truncate">{entry.label}</span>
			<Switch
				checked={entry.checked}
				onCheckedChange={(checked) => {
					entry.onToggle(checked === true);
				}}
				aria-label={entry.label}
			/>
		</div>
	{:else if entry.kind === "color-submenu"}
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger>
				{@render menuItemContent(entry.icon, entry.label)}
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class="min-w-[150px]">
				{#each colorOptions as option (option.name)}
					<SelectorItem
						label={option.label}
						selected={currentColor === option.name || currentColor === option.hex}
						onSelect={() => handleColorSelect(option.name)}
					>
						{#snippet leading()}
							<ProjectColorSwatch hex={option.hex} />
						{/snippet}
					</SelectorItem>
				{/each}
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
	{/if}
{/snippet}

<Selector
	bind:open={menuOpen}
	bind:triggerRef
	showChevron={false}
	align="end"
	side="bottom"
	variant="ghost"
	triggerSize="iconSm"
	triggerAriaLabel="Project menu"
	contentClass="min-w-[152px]"
>
	{#snippet renderButton()}
		<HugeiconsIcon name="more" />
	{/snippet}

	{#each menuSections as section, sectionIndex (section.id)}
		{#if sectionIndex > 0}
			<DropdownMenu.Separator />
		{/if}
		<DropdownMenu.Sub>
			<DropdownMenu.SubTrigger>
				{@render menuItemContent(section.icon, section.label)}
			</DropdownMenu.SubTrigger>
			<DropdownMenu.SubContent class={section.contentWidthClass}>
				{#each section.groups as group, groupIndex (group.id)}
					{#if groupIndex > 0}
						<DropdownMenu.Separator />
					{/if}

					{#each group.entries as entry (entry.id)}
						{@render menuEntry(entry)}
					{/each}
				{/each}
			</DropdownMenu.SubContent>
		</DropdownMenu.Sub>
	{/each}
</Selector>

<Popover.Root bind:open={showRemoveConfirm}>
	<Popover.Content
		align="start"
		customAnchor={triggerRef}
		onInteractOutside={() => (showRemoveConfirm = false)}
	>
		<p class="text-xs font-normal">Remove Project</p>
		<p class="text-xs font-normal text-muted-foreground">
			{`Remove "${projectName}" from your workspace? This will not delete any files.`}
		</p>
		<div class="flex gap-2">
			<Button variant="outline" size="xs" onclick={() => (showRemoveConfirm = false)}>
				Cancel
			</Button>
			<Button
				variant="destructive"
				size="xs"
				onclick={() => {
					onRemoveProject?.();
					showRemoveConfirm = false;
				}}
			>
				Delete
			</Button>
		</div>
	</Popover.Content>
</Popover.Root>
