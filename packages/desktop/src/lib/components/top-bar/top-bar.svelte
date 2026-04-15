<script lang="ts">
import { Button, SegmentedToggleGroup, VoiceDownloadProgress } from "@acepe/ui";
import { COLOR_NAMES, Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { AppTopBar } from "@acepe/ui/app-layout";
import { DropdownMenu as DropdownMenuPrimitive } from "bits-ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bug } from "phosphor-svelte";
import { Check } from "phosphor-svelte";
import { Columns } from "phosphor-svelte";
import { DownloadSimple } from "phosphor-svelte";
import { HardDrives } from "phosphor-svelte";
import { Kanban } from "phosphor-svelte";
import { SlidersHorizontal } from "phosphor-svelte";
import { Square } from "phosphor-svelte";
import { SquaresFour } from "phosphor-svelte";
import { Wrench } from "phosphor-svelte";
import type { Snippet } from "svelte";
import { getPanelStore } from "$lib/acp/store/index.js";
import type { ViewMode } from "$lib/acp/store/types.js";
import type { MainAppViewState } from "$lib/components/main-app-view/logic/main-app-view-state.svelte.js";
import type { UpdaterBannerState } from "$lib/components/main-app-view/logic/updater-state.js";
import { useTheme, type Theme } from "$lib/components/theme/index.js";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";


interface Props {
	viewState: MainAppViewState;
	/** Optional snippet for add project/repository button (e.g. dropdown). Rendered in top bar left after decorations. */
	addProjectButton?: Snippet;
	updaterState?: UpdaterBannerState;
	onUpdateClick?: () => void;
	onRetryUpdateClick?: () => void;
	onDevShowUpdatePage?: () => void;
	onDevShowDesignSystem?: () => void;
	showSidebarToggle?: boolean;
}

let {
	viewState,
	addProjectButton,
	updaterState,
	onUpdateClick,
	onRetryUpdateClick,
	onDevShowUpdatePage,
	onDevShowDesignSystem,
	showSidebarToggle = true,
}: Props = $props();

const panelStore = getPanelStore();
const themeState = useTheme();
const UPDATE_BUTTON_SEGMENT_COUNT = 16;
type DropdownMenuTriggerChildProps =
	NonNullable<DropdownMenuPrimitive.TriggerProps["child"]> extends Snippet<[infer T]> ? T : never;

const updateDownloadPercent = $derived(
	updaterState?.kind === "installing"
		? 100
		: updaterState?.kind === "downloading" && updaterState.totalBytes && updaterState.totalBytes > 0
			? Math.min(Math.round((updaterState.downloadedBytes / updaterState.totalBytes) * 100), 100)
			: 0
);

const updateActionText = $derived(
	updaterState?.kind === "installing" ? m.update_installing() : "Updating"
);

type LayoutFamily = "standard" | "kanban";
type ThemeOption = { value: Theme; label: string };

const layoutFamilies: { value: LayoutFamily; label: string; description: string; color: string }[] = [
	{ value: "standard", label: "Standard", description: "Classic panel layout.", color: Colors[COLOR_NAMES.PURPLE] },
	{ value: "kanban", label: "Kanban", description: "Board-style columns.", color: Colors[COLOR_NAMES.PINK] },
];
const themeOptions: ThemeOption[] = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
];

const standardViewModes: { value: Exclude<ViewMode, "kanban">; label: string; description: string; color: string }[] = [
	{ value: "single", label: "Single", description: "One agent at a time.", color: Colors[COLOR_NAMES.PURPLE] },
	{ value: "project", label: "Project", description: "Group by project.", color: Colors[COLOR_NAMES.ORANGE] },
	{ value: "multi", label: "Multi", description: "All agents side by side.", color: "var(--success)" },
];

const isKanbanView = $derived(panelStore.viewMode === "kanban");

const activeStandardViewMode = $derived.by((): Exclude<ViewMode, "kanban"> => {
	if (panelStore.viewMode === "kanban") {
		return "multi";
	}
	return panelStore.viewMode;
});

function switchLayoutFamily(nextFamily: LayoutFamily): void {
	if (nextFamily === "kanban") {
		panelStore.setViewMode("kanban");
		return;
	}

	panelStore.setViewMode(activeStandardViewMode);
}
</script>

<AppTopBar
	windowDraggable
	showTrafficLights={false}
	{showSidebarToggle}
	showAddProject={!!addProjectButton}
	{addProjectButton}
	onToggleSidebar={() => viewState.setSidebarOpen(!viewState.sidebarOpen)}
	onSettings={() => viewState.toggleSettings()}
	showAvatar={false}
	showSearch={false}
	showRightSectionLeadingBorder={panelStore.viewMode !== "kanban"}
>
	{#snippet extraLeftActions()}
		{#if updaterState?.kind === "available"}
			<div class="flex items-center pl-2">
			<Button variant="headerAction" size="headerAction" onclick={onUpdateClick}>
				{#snippet children()}
					Update
				{/snippet}
			</Button>
			</div>
		{:else if updaterState?.kind === "downloading" || updaterState?.kind === "installing"}
			<div class="flex items-center pl-2">
			<Button variant="headerAction" size="headerAction" disabled>
				{#snippet children()}
					<div class="flex items-center gap-2">
						<span>{updateActionText}</span>
						<div class="w-[52px]">
							<VoiceDownloadProgress
								ariaLabel={updaterState?.kind === "installing"
									? m.update_installing()
									: m.update_downloading()}
								compact={true}
								label=""
								percent={updateDownloadPercent}
								segmentCount={UPDATE_BUTTON_SEGMENT_COUNT}
								showPercent={false}
							/>
						</div>
					</div>
					{/snippet}
				</Button>
			</div>
		{:else if updaterState?.kind === "error"}
			<div class="flex items-center pl-2">
				<Button variant="headerAction" size="headerAction" onclick={onRetryUpdateClick}>
					{#snippet children()}
						Retry
					{/snippet}
				</Button>
			</div>
		{/if}
	{/snippet}
	{#snippet extraRightActions()}
		{#snippet layoutControl()}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props }: DropdownMenuTriggerChildProps)}
						<button
								{...props}
								class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
								title="Layout"
								aria-label="Layout Settings"
							>
								<SlidersHorizontal class="size-4" weight="fill" />
							</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content
					align="end"
					class="w-[200px]"
				>
					<DropdownMenu.Group>
						<DropdownMenu.GroupHeading class="px-2 py-1 text-[11px] font-medium text-muted-foreground">View</DropdownMenu.GroupHeading>
						{#each layoutFamilies as family (family.value)}
							{@const selected = isKanbanView ? family.value === "kanban" : family.value === "standard"}
							<DropdownMenu.Item
								onSelect={() => switchLayoutFamily(family.value)}
								class="cursor-pointer"
							>
								<div class="flex w-full items-start gap-2">
									<Check
										class={selected
											? "mt-0.5 size-3 shrink-0 text-foreground"
											: "mt-0.5 size-3 shrink-0 text-transparent"}
										weight="bold"
									/>
									{#if family.value === "kanban"}
										<Kanban class="mt-0.5 size-3 shrink-0" weight="fill" style="color: {family.color}" />
									{:else}
										<SquaresFour class="mt-0.5 size-3 shrink-0" weight="fill" style="color: {family.color}" />
									{/if}
									<div class="flex min-w-0 flex-1 flex-col">
										<span class="text-[12px] font-medium">{family.label}</span>
										<span class="text-[10px] leading-[1.25] text-muted-foreground">{family.description}</span>
									</div>
								</div>
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Group>

					{#if !isKanbanView}
						<DropdownMenu.Separator />
						<DropdownMenu.Group>
							<DropdownMenu.GroupHeading class="px-2 py-1 text-[11px] font-medium text-muted-foreground">Grouping</DropdownMenu.GroupHeading>
							{#each standardViewModes as mode (mode.value)}
								{@const selected = activeStandardViewMode === mode.value}
								<DropdownMenu.Item
									onSelect={() => panelStore.setViewMode(mode.value)}
									class="cursor-pointer"
								>
									<div class="flex w-full items-start gap-2">
										<Check
											class={selected
												? "mt-0.5 size-3 shrink-0 text-foreground"
												: "mt-0.5 size-3 shrink-0 text-transparent"}
											weight="bold"
										/>
										{#if mode.value === "single"}
											<Square class="mt-0.5 size-3 shrink-0" weight="fill" style="color: {mode.color}" />
										{:else if mode.value === "project"}
											<Columns class="mt-0.5 size-3 shrink-0" weight="fill" style="color: {mode.color}" />
										{:else}
											<SquaresFour class="mt-0.5 size-3 shrink-0" weight="fill" style="color: {mode.color}" />
										{/if}
										<div class="flex min-w-0 flex-1 flex-col">
											<span class="text-[12px] font-medium">{mode.label}</span>
											<span class="text-[10px] leading-[1.25] text-muted-foreground">{mode.description}</span>
										</div>
									</div>
								</DropdownMenu.Item>
								{#if mode.value === "single" && selected}
									<div class="flex items-center justify-between py-1 pl-[52px] pr-2">
										<span class="text-[11px] text-muted-foreground">Tab Bar</span>
										<Switch
											checked={viewState.topBarVisible}
											onclick={() => viewState.setTopBarVisible(!viewState.topBarVisible)}
										/>
									</div>
								{/if}
							{/each}
						</DropdownMenu.Group>
					{/if}

					<DropdownMenu.Separator />
					<div class="flex items-center justify-between gap-2 px-2 py-1.5">
						<div class="text-[11px] text-muted-foreground">Theme</div>
						<SegmentedToggleGroup
							items={themeOptions.map((o) => ({ id: o.value, label: o.label }))}
							value={themeState.theme}
							onChange={(id) => themeState.setTheme(id as Theme)}
						/>
					</div>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/snippet}
		{@render layoutControl()}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					title="Feedback"
					aria-label="Feedback"
					onclick={() => openUrl("https://github.com/flazouh/acepe/issues")}
				>
					<Bug weight="fill" class="size-4" style="color: #FF5D5A" />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Feedback</Tooltip.Content>
		</Tooltip.Root>
		{#if import.meta.env.DEV && (onDevShowUpdatePage || onDevShowDesignSystem)}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props }: DropdownMenuTriggerChildProps)}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<button
									{...props}
									class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
									title="Dev Tools"
									aria-label="Dev Tools"
								>
									<Wrench class="size-4" weight="fill" style="color: #FAD83C" />
								</button>
							</Tooltip.Trigger>
							<Tooltip.Content>Dev Tools</Tooltip.Content>
						</Tooltip.Root>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-[160px] p-0 text-[11px]">
					<DropdownMenu.Group>
						<DropdownMenu.GroupHeading
							class="px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20"
						>Dev Overlays</DropdownMenu.GroupHeading>
						{#if onDevShowUpdatePage}
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevShowUpdatePage}
							>
								<DownloadSimple class="size-4" weight="fill" />
								<span>Update Page</span>
							</DropdownMenu.Item>
						{/if}
						{#if onDevShowDesignSystem}
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevShowDesignSystem}
							>
								<Palette class="size-4" weight="fill" />
								<span>Design System</span>
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		{/if}
		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					class="flex items-center justify-center size-6 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
					title="Database Manager"
					aria-label="Database Manager"
					onclick={() => viewState.toggleSqlStudio()}
				>
					<HardDrives weight="fill" class="size-4" />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>Database Manager</Tooltip.Content>
		</Tooltip.Root>
	{/snippet}
</AppTopBar>
