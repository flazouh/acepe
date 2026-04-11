<script lang="ts">
	import type { Snippet } from "svelte";
	import { FolderPlus } from "phosphor-svelte";
	import { GearSix } from "phosphor-svelte";
	import { Sidebar } from "phosphor-svelte";
	import AppSearchButton from "./app-search-button.svelte";

	interface Props {
		showTrafficLights?: boolean;
		/** When true, adds data-tauri-drag-region for desktop window dragging */
		windowDraggable?: boolean;
		/** Label shown in the search button */
		searchLabel?: string;
		onToggleSidebar?: () => void;
		onSearch?: () => void;
		onSettings?: () => void;
		/** Override the add-project button (e.g. desktop wraps in a dropdown) */
		addProjectButton?: Snippet;
		/** Extra actions rendered after sidebar/add-project on the left */
		extraLeftActions?: Snippet;
		/** Extra actions rendered before settings (e.g. discord, theme toggle) */
		extraRightActions?: Snippet;
		/** Override the avatar area (e.g. AvatarPlaceholder in desktop) */
		avatar?: Snippet;
		/** Toggle avatar/account button visibility */
		showAvatar?: boolean;
		/** Toggle settings button visibility in the right section */
		showSettings?: boolean;
		/** Toggle sidebar button visibility in the left section */
		showSidebarToggle?: boolean;
		/** Toggle add project button visibility in the left section */
		showAddProject?: boolean;
		/** Toggle the leading border on the right action rail */
		showRightSectionLeadingBorder?: boolean;
		/** Toggle the center search/command palette button */
		showSearch?: boolean;
	}

	const ICON = "size-4";

	let {
		showTrafficLights = true,
		windowDraggable = false,
		searchLabel,
		onToggleSidebar,
		onSearch,
		onSettings,
		addProjectButton,
		extraLeftActions,
		extraRightActions,
		avatar,
		showAvatar = true,
		showSettings = true,
		showSidebarToggle = true,
		showAddProject = true,
		showRightSectionLeadingBorder = true,
		showSearch = true,
	}: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="h-7 flex items-center justify-between shrink-0"
	data-tauri-drag-region={windowDraggable || undefined}
>
	<!-- Left section: traffic lights + sidebar + add project -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="pl-[4.25rem] min-w-[4.25rem] flex items-center h-full relative"
		data-tauri-drag-region={windowDraggable || undefined}
	>
		{#if showTrafficLights}
			<div class="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
				<div class="h-3 w-3 rounded-full bg-[#FF5F57]"></div>
				<div class="h-3 w-3 rounded-full bg-[#FFBD2E]"></div>
				<div class="h-3 w-3 rounded-full bg-[#28CA42]"></div>
			</div>
		{/if}
		<div class="flex items-center gap-1">
			{#if showSidebarToggle}
				<button
					class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					title="Toggle sidebar"
					aria-label="Toggle Sidebar"
					onclick={onToggleSidebar}
				>
					<Sidebar class={ICON} weight="fill" />
				</button>
			{/if}
			{#if showAddProject}
				{#if addProjectButton}
					{@render addProjectButton()}
				{:else}
					<button
						class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
						title="Add project"
						aria-label="Add Project"
					>
						<FolderPlus class={ICON} weight="fill" />
					</button>
				{/if}
			{/if}
		</div>
		{#if extraLeftActions}
			{@render extraLeftActions()}
		{/if}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex-1 flex justify-center"
		data-tauri-drag-region={windowDraggable || undefined}
	>
		{#if showSearch}
			<AppSearchButton label={searchLabel} onclick={onSearch} />
		{/if}
	</div>

	<!-- Right: extra actions + settings + avatar -->
	<div class="flex items-center gap-1 pr-2">
		{#if extraRightActions}
			{@render extraRightActions()}
		{/if}
		{#if showSettings}
			<button
				class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
				title="Settings"
				aria-label="Settings"
				onclick={onSettings}
			>
				<GearSix class={ICON} weight="fill" />
			</button>
		{/if}
		{#if showAvatar}
			{#if avatar}
				{@render avatar()}
			{:else}
				<div class="h-6 w-6 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 border border-border"></div>
			{/if}
		{/if}
	</div>
</div>
