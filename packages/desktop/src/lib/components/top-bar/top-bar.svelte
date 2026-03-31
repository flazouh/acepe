<script lang="ts">
import { AppTopBar } from "@acepe/ui/app-layout";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { EmbeddedIconButton, HeaderCell } from "@acepe/ui/panel-header";
import { PillButton } from "@acepe/ui";
import { openUrl } from "@tauri-apps/plugin-opener";
import Bug from "phosphor-svelte/lib/Bug";
import Columns from "phosphor-svelte/lib/Columns";
import DiscordLogo from "phosphor-svelte/lib/DiscordLogo";
import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";
import GithubLogo from "phosphor-svelte/lib/GithubLogo";
import HardDrives from "phosphor-svelte/lib/HardDrives";
import Kanban from "phosphor-svelte/lib/Kanban";
import Rows from "phosphor-svelte/lib/Rows";
import Sidebar from "phosphor-svelte/lib/Sidebar";
import SlidersHorizontal from "phosphor-svelte/lib/SlidersHorizontal";
import Square from "phosphor-svelte/lib/Square";
import SquaresFour from "phosphor-svelte/lib/SquaresFour";
import Wrench from "phosphor-svelte/lib/Wrench";
import type { Snippet } from "svelte";
import { getPanelStore } from "$lib/acp/store/index.js";
import type { ViewMode } from "$lib/acp/store/types.js";
import type { MainAppViewState } from "$lib/components/main-app-view/logic/main-app-view-state.svelte.js";
import type { UpdaterBannerState } from "$lib/components/main-app-view/logic/updater-state.js";
import { ThemeToggle } from "$lib/components/theme/index.js";
import VoiceDownloadProgress from "$lib/components/voice-download-progress.svelte";
import { Switch } from "$lib/components/ui/switch/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	viewState: MainAppViewState;
	/** Optional snippet for add project/repository button (e.g. dropdown). Rendered in top bar left after decorations. */
	addProjectButton?: Snippet;
	updaterState?: UpdaterBannerState;
	onUpdateClick?: () => void;
	onRetryUpdateClick?: () => void;
	onDevShowUpdatePage?: () => void;
}

let {
	viewState,
	addProjectButton,
	updaterState,
	onUpdateClick,
	onRetryUpdateClick,
	onDevShowUpdatePage,
}: Props = $props();

const panelStore = getPanelStore();
const UPDATE_BUTTON_SEGMENT_COUNT = 16;

const updateDownloadPercent = $derived(
	updaterState?.kind === "downloading" && updaterState.totalBytes && updaterState.totalBytes > 0
		? Math.min(
				Math.round((updaterState.downloadedBytes / updaterState.totalBytes) * 100),
				100
			)
		: 0
);

const viewModes: { value: ViewMode; label: string; color: string }[] = [
	{ value: "single", label: "Single", color: "#9858FF" },
	{ value: "project", label: "Project", color: "#FF8D20" },
	{ value: "multi", label: "Multi", color: "var(--success)" },
	{ value: "kanban", label: "Kanban", color: "#3B82F6" },
];
</script>

<AppTopBar
	windowDraggable
	showTrafficLights={false}
	searchLabel={m.top_bar_command_palette()}
	showSidebarToggle={true}
	showAddProject={!!addProjectButton}
	{addProjectButton}
	onToggleSidebar={() => viewState.setSidebarOpen(!viewState.sidebarOpen)}
	onSearch={() => (viewState.commandPaletteOpen = true)}
	onSettings={() => viewState.toggleSettings()}
	showAvatar={false}
>
	{#snippet extraLeftActions()}
		{#if updaterState?.kind === "available"}
			<div class="flex items-center pl-2">
			<PillButton variant="invert" size="xs" onclick={onUpdateClick}>
				{#snippet children()}
					Update
				{/snippet}
			</PillButton>
			</div>
		{:else if updaterState?.kind === "downloading"}
			<div class="flex items-center pl-2">
			<PillButton variant="invert" size="xs" disabled>
				{#snippet children()}
					<div class="flex items-center gap-2">
						<span>Updating</span>
						<div class="w-[52px]">
							<VoiceDownloadProgress
								ariaLabel={m.update_downloading()}
								compact={true}
								label=""
								percent={updateDownloadPercent}
								segmentCount={UPDATE_BUTTON_SEGMENT_COUNT}
								showPercent={false}
							/>
						</div>
					</div>
					{/snippet}
				</PillButton>
			</div>
		{:else if updaterState?.kind === "error"}
			<div class="flex items-center pl-2">
				<PillButton variant="ghost" size="xs" onclick={onRetryUpdateClick}>
					{#snippet children()}
						Retry
					{/snippet}
				</PillButton>
			</div>
		{/if}
	{/snippet}
	{#snippet extraRightActions()}
		<HeaderCell withDivider={false}>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<EmbeddedIconButton {...props} title="Layout" ariaLabel="Layout Settings">
									<SlidersHorizontal class="size-4" weight="fill" />
								</EmbeddedIconButton>
							</Tooltip.Trigger>
							<Tooltip.Content>Layout</Tooltip.Content>
						</Tooltip.Root>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="min-w-[160px] p-0 text-[11px]">
					<DropdownMenu.Group>
						<DropdownMenu.GroupHeading
							class="px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20"
							>Interface</DropdownMenu.GroupHeading
						>
						<DropdownMenu.Item
							class="cursor-pointer rounded-none border-b border-border/20 px-2 py-1 text-[11px]"
							onSelect={(e) => e.preventDefault()}
							onclick={() => viewState.setSidebarOpen(!viewState.sidebarOpen)}
						>
							<Sidebar class="size-4" weight="fill" />
							<span class="flex-1">Sidebar</span>
							<Switch
								checked={viewState.sidebarOpen}
								class="data-[state=checked]:bg-foreground/50 data-[state=unchecked]:bg-input/60 h-3.5 w-6 [&_[data-slot=switch-thumb]]:size-2.5 [&_[data-slot=switch-thumb]]:data-[state=checked]:translate-x-[11px]"
							/>
						</DropdownMenu.Item>
						<DropdownMenu.Item
							class="cursor-pointer rounded-none border-b border-border/20 px-2 py-1 text-[11px]"
							onSelect={(e) => e.preventDefault()}
							onclick={() => viewState.setTopBarVisible(!viewState.topBarVisible)}
						>
							<Rows class="size-4" weight="fill" />
							<span class="flex-1">Tab Bar</span>
							<Switch
								checked={viewState.topBarVisible}
								class="data-[state=checked]:bg-foreground/50 data-[state=unchecked]:bg-input/60 h-3.5 w-6 [&_[data-slot=switch-thumb]]:size-2.5 [&_[data-slot=switch-thumb]]:data-[state=checked]:translate-x-[11px]"
							/>
						</DropdownMenu.Item>
					</DropdownMenu.Group>
					<DropdownMenu.Group>
						<DropdownMenu.GroupHeading
							class="px-2 py-1 text-[11px] font-semibold text-muted-foreground border-b border-border/20"
							>View</DropdownMenu.GroupHeading
						>
						<div class="flex items-stretch gap-0 rounded-md bg-muted/50 mx-2 my-1.5">
							{#each viewModes as mode (mode.value)}
								{@const isActive = panelStore.viewMode === mode.value}
								<button
									class="flex-1 flex items-center justify-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors cursor-pointer {isActive ? 'bg-muted text-foreground/80' : 'text-muted-foreground hover:text-foreground'}"
									onclick={() => panelStore.setViewMode(mode.value)}
								>
									{#if mode.value === "single"}
										<Square class="size-3" weight="fill" style="color: {mode.color}" />
									{:else if mode.value === "project"}
										<Columns class="size-3" weight="fill" style="color: {mode.color}" />
									{:else if mode.value === "multi"}
										<SquaresFour class="size-3" weight="fill" style="color: {mode.color}" />
									{:else}
										<Kanban class="size-3" weight="fill" style="color: {mode.color}" />
									{/if}
									{mode.label}
								</button>
							{/each}
						</div>
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</HeaderCell>
		<HeaderCell withDivider={false}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<EmbeddedIconButton
						title="Feedback"
						ariaLabel="Feedback"
						onclick={() => openUrl("https://github.com/flazouh/acepe/issues")}
					>
						<Bug weight="fill" class="size-4" style="color: #FF5D5A" />
					</EmbeddedIconButton>
				</Tooltip.Trigger>
				<Tooltip.Content>Feedback</Tooltip.Content>
			</Tooltip.Root>
		</HeaderCell>
		<HeaderCell withDivider={false}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<EmbeddedIconButton
						title="Join Discord"
						ariaLabel="Discord"
						onclick={() => openUrl("https://discord.gg/5YhW7T7qhS")}
					>
						<DiscordLogo class="size-4" style="color: #6C75E8" weight="fill" />
					</EmbeddedIconButton>
				</Tooltip.Trigger>
				<Tooltip.Content>Join Discord</Tooltip.Content>
			</Tooltip.Root>
		</HeaderCell>
		<HeaderCell withDivider={false}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<EmbeddedIconButton
						title="GitHub"
						ariaLabel="GitHub"
						onclick={() => openUrl("https://github.com/flazouh/acepe")}
					>
						<GithubLogo class="size-4" weight="fill" />
					</EmbeddedIconButton>
				</Tooltip.Trigger>
				<Tooltip.Content>GitHub</Tooltip.Content>
			</Tooltip.Root>
		</HeaderCell>
		<HeaderCell withDivider={false}>
			<ThemeToggle />
		</HeaderCell>
		{#if import.meta.env.DEV && onDevShowUpdatePage}
			<HeaderCell withDivider={false}>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Tooltip.Root>
								<Tooltip.Trigger>
									<EmbeddedIconButton {...props} title="Dev Tools" ariaLabel="Dev Tools">
										<Wrench class="size-4" weight="fill" style="color: #FAD83C" />
									</EmbeddedIconButton>
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
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevShowUpdatePage}
							>
								<DownloadSimple class="size-4" weight="fill" />
								<span>Update Page</span>
							</DropdownMenu.Item>
						</DropdownMenu.Group>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</HeaderCell>
		{/if}
		<HeaderCell withDivider={false}>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<EmbeddedIconButton
						title="Database Manager"
						ariaLabel="Database Manager"
						onclick={() => viewState.toggleSqlStudio()}
					>
						<HardDrives weight="fill" class="size-4" />
					</EmbeddedIconButton>
				</Tooltip.Trigger>
				<Tooltip.Content>Database Manager</Tooltip.Content>
			</Tooltip.Root>
		</HeaderCell>
	{/snippet}
</AppTopBar>
