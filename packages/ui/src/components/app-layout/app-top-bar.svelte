<script lang="ts">
	import type { Snippet } from "svelte";
	import FolderPlus from "phosphor-svelte/lib/FolderPlus";
	import GearSix from "phosphor-svelte/lib/GearSix";
	import Sidebar from "phosphor-svelte/lib/Sidebar";
	import { HeaderCell, EmbeddedIconButton } from "../panel-header/index.js";
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
		/** Extra actions rendered before settings (e.g. discord, theme toggle) */
		extraRightActions?: Snippet;
		/** Override the avatar area (e.g. AvatarPlaceholder in desktop) */
		avatar?: Snippet;
		/** Toggle avatar/account button visibility */
		showAvatar?: boolean;
		/** Toggle sidebar button visibility in the left section */
		showSidebarToggle?: boolean;
		/** Toggle add project button visibility in the left section */
		showAddProject?: boolean;
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
		extraRightActions,
		avatar,
		showAvatar = true,
		showSidebarToggle = true,
		showAddProject = true,
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
		<div class="flex items-center h-full divide-x divide-border/50 border-x border-border/50">
			{#if showSidebarToggle}
				<HeaderCell withDivider={false}>
					{#snippet children()}
						<EmbeddedIconButton title="Toggle sidebar" ariaLabel="Toggle Sidebar" onclick={onToggleSidebar}>
							<Sidebar class={ICON} weight="fill" />
						</EmbeddedIconButton>
					{/snippet}
				</HeaderCell>
			{/if}
			{#if showAddProject}
				<HeaderCell withDivider={false}>
					{#snippet children()}
						{#if addProjectButton}
							{@render addProjectButton()}
						{:else}
							<EmbeddedIconButton title="Add project" ariaLabel="Add Project">
								<FolderPlus class={ICON} weight="fill" />
							</EmbeddedIconButton>
						{/if}
					{/snippet}
				</HeaderCell>
			{/if}
		</div>
	</div>

	<!-- Center: search -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex-1 flex justify-center"
		data-tauri-drag-region={windowDraggable || undefined}
	>
		<AppSearchButton label={searchLabel} onclick={onSearch} />
	</div>

	<!-- Right: extra actions + settings + avatar -->
	<div class="flex items-center h-full divide-x divide-border/50 border-x border-border/50">
		{#if extraRightActions}
			{@render extraRightActions()}
		{/if}
		<HeaderCell withDivider={false}>
			{#snippet children()}
				<EmbeddedIconButton title="Settings" ariaLabel="Settings" onclick={onSettings}>
					<GearSix class={ICON} weight="fill" />
				</EmbeddedIconButton>
			{/snippet}
		</HeaderCell>
		{#if showAvatar}
			<HeaderCell withDivider={false} class="pr-3">
				{#snippet children()}
					{#if avatar}
						{@render avatar()}
					{:else}
						<div class="h-6 w-6 rounded-full bg-gradient-to-br from-primary/40 to-primary/20 border border-border"></div>
					{/if}
				{/snippet}
			</HeaderCell>
		{/if}
	</div>
</div>
