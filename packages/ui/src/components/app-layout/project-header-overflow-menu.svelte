<script lang="ts">
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import * as Popover from "../popover/index.js";
	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";
	import { Selector } from "../selector/index.js";
	import { Switch } from "../switch/index.js";
	import { SelectorItem } from "../selector/index.js";
	import { PROJECT_COLOR_OPTIONS } from "./project-color-options.js";
	import ProjectColorSwatch from "./project-color-swatch.svelte";
	import { buildProjectHeaderOverflowMenuState } from "./project-menu-state.js";

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
	const showSettingsSection = $derived(menuState.showSettingsSection);
	const showSessionsSection = $derived(Boolean(onHideExternalCliSessionsChange));

	function handleRemoveClick() {
		menuOpen = false;
		showRemoveConfirm = true;
	}

	function closeMenu() {
		menuOpen = false;
	}
</script>

<Selector
	bind:open={menuOpen}
	bind:triggerRef
	showChevron={false}
	align="end"
	side="bottom"
	variant="ghost"
	triggerSize="iconSm"
	triggerAriaLabel="Project menu"
>
	{#snippet renderButton()}
		<RoundedIcon name="more" />
	{/snippet}

	{#if onMoveUp || onMoveDown}
		<DropdownMenu.Group>
			{#if onMoveUp}
				<SelectorItem
					label="Move Up"
					disabled={moveUpDisabled}
					onSelect={() => {
						onMoveUp?.();
						closeMenu();
					}}
				/>
			{/if}
			{#if onMoveDown}
				<SelectorItem
					label="Move Down"
					disabled={moveDownDisabled}
					onSelect={() => {
						onMoveDown?.();
						closeMenu();
					}}
				/>
			{/if}
		</DropdownMenu.Group>
	{/if}
	{#if showSessionsSection}
		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading>Sessions</DropdownMenu.GroupHeading>
			<div
				class="flex items-center justify-between gap-3 px-2 py-1.5"
				role="presentation"
				onclick={(event) => event.stopPropagation()}
				onkeydown={(event) => event.stopPropagation()}
			>
				<span class="min-w-0 text-xs text-foreground">{hideExternalCliSessionsLabel}</span>
				<Switch
					checked={hideExternalCliSessions}
					onCheckedChange={(checked) => {
						onHideExternalCliSessionsChange?.(checked === true);
					}}
					aria-label={hideExternalCliSessionsLabel}
				/>
			</div>
		</DropdownMenu.Group>
	{/if}
	{#if showSettingsSection}
		<DropdownMenu.Group>
			<DropdownMenu.GroupHeading>Settings</DropdownMenu.GroupHeading>
			{#if onChangeProjectIcon}
				<SelectorItem
					label="Change icon..."
					onSelect={() => {
						onChangeProjectIcon();
						closeMenu();
					}}
				/>
			{/if}
			{#if onColorChange && !hasIcon}
				<DropdownMenu.Sub>
					<DropdownMenu.SubTrigger>Color</DropdownMenu.SubTrigger>
					<DropdownMenu.SubContent>
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
			{#if hasIcon && onResetProjectIcon}
				<SelectorItem
					label="Reset to letter badge"
					onSelect={() => {
						onResetProjectIcon();
						closeMenu();
					}}
				/>
			{/if}
			{#if onRemoveProject}
				<DropdownMenu.Item variant="destructive" onSelect={handleRemoveClick}>
					Remove Project
				</DropdownMenu.Item>
			{/if}
		</DropdownMenu.Group>
	{/if}
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
