<script lang="ts">
import type { Snippet } from "svelte";
import { Button } from "../button/index.js";
import { HugeiconsIcon, type HugeiconsIconName } from "../icons/index.js";
import AppSearchButton from "./app-search-button.svelte";

/**
 * The desktop shell hides the native title bar, so this row is the window
 * chrome. The shell moves the window on mousedown inside a drag region and
 * skips anything inside a no-drag region, so every control opts out.
 */
const DRAG_REGION_CLASS = "electrobun-webkit-app-region-drag";
const NO_DRAG_REGION_CLASS = "electrobun-webkit-app-region-no-drag";

interface Props {
	showTrafficLights?: boolean;
	/** When true, the bar acts as the window drag region on desktop */
	windowDraggable?: boolean;
	/** Label shown in the search button */
	searchLabel?: string;
	onToggleSidebar?: () => void;
	onSearch?: () => void;
	onSettings?: () => void;
	/** Override the add-project button (e.g. desktop wraps in a dropdown) */
	addProjectButton?: Snippet;
	/** Extra actions rendered after sidebar/add-project, inside the same left rail */
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
	/** Whether the workspace sidebar is currently open */
	sidebarOpen?: boolean;
	/** Toggle add project button visibility in the left section */
	showAddProject?: boolean;
	/** Toggle the leading border on the right action rail */
	showRightSectionLeadingBorder?: boolean;
	/** Toggle the center search/command palette button */
	showSearch?: boolean;
}

const chromeIconButton = {
	variant: "ghost" as const,
	size: "icon" as const,
};

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
	sidebarOpen = true,
}: Props = $props();

const sidebarIconName = $derived<HugeiconsIconName>(
	sidebarOpen ? "sidebar-open" : "sidebar-closed",
);

const dragRegionClass = $derived(windowDraggable ? DRAG_REGION_CLASS : "");
const noDragRegionClass = $derived(windowDraggable ? NO_DRAG_REGION_CLASS : "");
</script>

<div
	class="h-7 flex items-center justify-between shrink-0 {dragRegionClass}"
	data-testid="app-top-bar"
>
	<!-- Left section: traffic lights + sidebar + add project -->
	<div class="pl-[4.25rem] min-w-[4.25rem] flex items-center h-full relative">
		{#if showTrafficLights}
			<div class="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
				<div class="h-3 w-3 rounded-full bg-[#FF5F57]"></div>
				<div class="h-3 w-3 rounded-full bg-[#FFBD2E]"></div>
				<div class="h-3 w-3 rounded-full bg-[#28CA42]"></div>
			</div>
		{/if}
		<div class="flex items-center gap-1 {noDragRegionClass}">
			{#if showSidebarToggle}
				<Button
					{...chromeIconButton}
					title="Toggle sidebar"
					aria-label="Toggle Sidebar"
					onclick={onToggleSidebar}
				>
					{#snippet children()}
						<HugeiconsIcon
							name={sidebarIconName}
							data-testid="app-top-bar-sidebar-icon"
						/>
					{/snippet}
				</Button>
			{/if}
			{#if showAddProject}
				{#if addProjectButton}
					{@render addProjectButton()}
				{:else}
					<Button {...chromeIconButton} title="Add project" aria-label="Add Project">
						{#snippet children()}
							<HugeiconsIcon name="plus" />
						{/snippet}
					</Button>
				{/if}
			{/if}
			{#if extraLeftActions}
				{@render extraLeftActions()}
			{/if}
		</div>
	</div>
	<div class="flex-1 flex justify-center">
		{#if showSearch}
			<div class={noDragRegionClass}>
				<AppSearchButton label={searchLabel} onclick={onSearch} />
			</div>
		{/if}
	</div>

	<!-- Right: extra actions + settings + avatar -->
	<div class="flex items-center gap-1 pr-2 {noDragRegionClass}">
		{#if extraRightActions}
			{@render extraRightActions()}
		{/if}
		{#if showSettings}
			<Button {...chromeIconButton} title="Settings" aria-label="Settings" onclick={onSettings}>
				{#snippet children()}
					<HugeiconsIcon name="settings" />
				{/snippet}
			</Button>
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
