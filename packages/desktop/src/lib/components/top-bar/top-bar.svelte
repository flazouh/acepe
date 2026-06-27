<script lang="ts">
import {
	Button,
	SegmentedToggleGroup,
	Selector,
	UsageLimitWidget,
	SegmentedProgressBar,
} from "@acepe/ui";
import { COLOR_NAMES, Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { AppTopBar } from "@acepe/ui/app-layout";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Bug } from "@acepe/ui/icons";
import { Check } from "@acepe/ui/icons";
import { Columns } from "@acepe/ui/icons";
import { DownloadSimple } from "@acepe/ui/icons";
import { HardDrives } from "@acepe/ui/icons";
import { Kanban } from "@acepe/ui/icons";
import { Palette } from "@acepe/ui/icons";
import { SlidersHorizontal } from "@acepe/ui/icons";
import { Square } from "@acepe/ui/icons";
import { SquaresFour } from "@acepe/ui/icons";
import { Wrench } from "@acepe/ui/icons";
import { onMount, type Snippet } from "svelte";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import type { ViewMode } from "$lib/acp/store/types.js";
import type { MainAppViewState } from "$lib/components/main-app-view/logic/main-app-view-state.svelte.js";
import type { UpdaterBannerState } from "$lib/components/main-app-view/logic/updater-state.js";
import { useTheme, type Theme } from "$lib/components/theme/index.js";
import * as Tooltip from "@acepe/ui/tooltip";
import {
	buildLiveUsageWidgetModel,
	type UsageProviderAccount,
	type UsageWidgetTelemetrySession,
} from "./usage-widget-model.js";
import {
	buildProviderUsageCheckingAccounts,
	buildProviderUsageErrorAccounts,
	loadProviderAccountUsageAccounts,
} from "./provider-account-usage-source.js";
interface Props {
	viewState: MainAppViewState;
	/** Optional snippet for add project/repository button (e.g. dropdown). Rendered in top bar left after decorations. */
	addProjectButton?: Snippet;
	updaterState?: UpdaterBannerState;
	onUpdateClick?: () => void;
	onRetryUpdateClick?: () => void;
	onDevShowUpdatePage?: () => void;
	onDevShowDesignSystem?: () => void;
	onDevShowStreamingReproLab?: () => void;
	onDevResetOnboarding?: () => void;
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
	onDevShowStreamingReproLab,
	onDevResetOnboarding,
	showSidebarToggle = true,
}: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const themeState = useTheme();
const UPDATE_BUTTON_SEGMENT_COUNT = 16;
const USAGE_REFRESH_INTERVAL_MS = 60_000;
const USAGE_EVENT_REFRESH_DEBOUNCE_MS = 250;
const PROVIDER_ACCOUNT_USAGE_UPDATED_EVENT = "provider-account-usage://updated";
let providerUsageAccounts = $state.raw<ReadonlyArray<UsageProviderAccount>>(
	buildProviderUsageCheckingAccounts()
);

const updateDownloadPercent = $derived(
	updaterState?.kind === "installing"
		? 100
		: updaterState?.kind === "downloading" && updaterState.totalBytes && updaterState.totalBytes > 0
			? Math.min(Math.round((updaterState.downloadedBytes / updaterState.totalBytes) * 100), 100)
			: 0
);

const updateActionText = $derived(
	updaterState?.kind === "installing" ? "Installing update..." : "Updating"
);

type LayoutFamily = "standard" | "kanban";
type ThemeOption = { value: Theme; label: string };

const layoutFamilies: { value: LayoutFamily; label: string; description: string; color: string }[] =
	[
		{
			value: "standard",
			label: "Standard",
			description: "Classic panel layout.",
			color: Colors[COLOR_NAMES.PURPLE],
		},
		{
			value: "kanban",
			label: "Kanban",
			description: "Board-style columns.",
			color: Colors[COLOR_NAMES.PINK],
		},
	];
const themeOptions: ThemeOption[] = [
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
	{ value: "system", label: "System" },
];

const standardViewModes: {
	value: Exclude<ViewMode, "kanban">;
	label: string;
	description: string;
	color: string;
}[] = [
	{
		value: "single",
		label: "Single",
		description: "One agent at a time.",
		color: Colors[COLOR_NAMES.PURPLE],
	},
	{
		value: "project",
		label: "Project",
		description: "Group by project.",
		color: Colors[COLOR_NAMES.ORANGE],
	},
	{
		value: "multi",
		label: "Multi",
		description: "All agents side by side.",
		color: "var(--success)",
	},
];

const isKanbanView = $derived(panelStore.viewMode === "kanban");

const focusedSessionId = $derived(panelStore.focusedPanel?.sessionId ?? null);
const usageTelemetrySessions = $derived.by((): UsageWidgetTelemetrySession[] => {
	const sessions = sessionStore.read.getAllSessions();
	const telemetrySessions: UsageWidgetTelemetrySession[] = [];

	for (const session of sessions) {
		telemetrySessions.push({
			session,
			telemetry: sessionStore.read.getSessionUsageTelemetry(session.id),
			currentModelId: sessionStore.read.getSessionCurrentModelId(session.id),
			focused: session.id === focusedSessionId,
		});
	}

	return telemetrySessions;
});
const usageWidgetModel = $derived(
	buildLiveUsageWidgetModel({
		sessions: usageTelemetrySessions,
		nowMs: Date.now(),
		accounts: providerUsageAccounts,
	})
);

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

function refreshProviderUsageAccounts(): void {
	void loadProviderAccountUsageAccounts().match(
		(accounts) => {
			providerUsageAccounts = accounts;
		},
		() => {
			providerUsageAccounts = buildProviderUsageErrorAccounts();
		}
	);
}

onMount(() => {
	let disposed = false;
	let quotaUpdateUnlisten: UnlistenFn | null = null;
	let quotaUpdateRefreshTimeout: ReturnType<typeof window.setTimeout> | null = null;

	function scheduleProviderUsageRefresh(): void {
		if (quotaUpdateRefreshTimeout !== null) {
			window.clearTimeout(quotaUpdateRefreshTimeout);
		}

		quotaUpdateRefreshTimeout = window.setTimeout(() => {
			quotaUpdateRefreshTimeout = null;
			refreshProviderUsageAccounts();
		}, USAGE_EVENT_REFRESH_DEBOUNCE_MS);
	}

	refreshProviderUsageAccounts();
	const intervalId = window.setInterval(refreshProviderUsageAccounts, USAGE_REFRESH_INTERVAL_MS);
	void listen(PROVIDER_ACCOUNT_USAGE_UPDATED_EVENT, () => {
		scheduleProviderUsageRefresh();
	}).then((unlisten) => {
		if (disposed) {
			void unlisten();
			return;
		}
		quotaUpdateUnlisten = unlisten;
	});

	return () => {
		disposed = true;
		window.clearInterval(intervalId);
		if (quotaUpdateRefreshTimeout !== null) {
			window.clearTimeout(quotaUpdateRefreshTimeout);
		}
		if (quotaUpdateUnlisten !== null) {
			quotaUpdateUnlisten();
		}
	};
});
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
			<Button variant="headerProminent" size="headerAction" class="!h-5 !min-h-5" onclick={onUpdateClick}>
				{#snippet children()}
					Update
				{/snippet}
			</Button>
			</div>
		{:else if updaterState?.kind === "downloading" || updaterState?.kind === "installing"}
			<div class="flex items-center pl-2">
			<Button variant="headerProminent" size="headerAction" class="!h-5 !min-h-5" disabled>
				{#snippet children()}
					<div class="flex items-center gap-2">
						<span>{updateActionText}</span>
						<div class="w-[52px]">
							<SegmentedProgressBar
								ariaLabel={updaterState?.kind === "installing"
									? "Installing update..."
									: "Downloading update"}
								label=""
								percent={updateDownloadPercent}
								segmentCount={UPDATE_BUTTON_SEGMENT_COUNT}
								showPercent={false}
								variant="downloadCompact"
							/>
						</div>
					</div>
					{/snippet}
				</Button>
			</div>
		{:else if updaterState?.kind === "error"}
			<div class="flex items-center pl-2">
				<Button variant="headerProminent" size="headerAction" class="!h-5 !min-h-5" onclick={onRetryUpdateClick}>
					{#snippet children()}
						Retry
					{/snippet}
				</Button>
			</div>
		{/if}
	{/snippet}
	{#snippet extraRightActions()}
		{#snippet layoutControl()}
			<Selector
				align="end"
				variant="chromeIcon"
				triggerSize="chromeIcon"
				showChevron={false}
				tooltipLabel="Layout"
				triggerAriaLabel="Layout Settings"
			>
				{#snippet renderButton()}
					<SlidersHorizontal class="size-3.5" weight="fill" />
				{/snippet}

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
			</Selector>
		{/snippet}
		<UsageLimitWidget model={usageWidgetModel} onRefresh={refreshProviderUsageAccounts} />
		{@render layoutControl()}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="chromeIcon"
						size="chromeIcon"
						aria-label="Feedback"
						onclick={() => openUrl("https://github.com/flazouh/acepe/issues")}
					>
						{#snippet children()}
							<Bug weight="fill" class="size-3.5" style="color: #FF5D5A" />
						{/snippet}
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>Feedback</Tooltip.Content>
		</Tooltip.Root>
		{#if import.meta.env.DEV && (onDevShowUpdatePage || onDevShowDesignSystem || onDevShowStreamingReproLab || onDevResetOnboarding)}
			<Selector
				align="end"
				variant="chromeIcon"
				triggerSize="chromeIcon"
				showChevron={false}
				tooltipLabel="Dev Tools"
				triggerAriaLabel="Dev Tools"
			>
				{#snippet renderButton()}
					<Wrench class="size-3.5" weight="fill" style="color: #FAD83C" />
				{/snippet}

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
						{#if onDevShowStreamingReproLab}
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevShowStreamingReproLab}
							>
								<Wrench class="size-4" weight="fill" />
								<span>Streaming Repro Lab</span>
							</DropdownMenu.Item>
						{/if}
						{#if onDevResetOnboarding}
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevResetOnboarding}
							>
								<Wrench class="size-4" weight="fill" />
								<span>Reset Onboarding</span>
							</DropdownMenu.Item>
						{/if}
					</DropdownMenu.Group>
			</Selector>
		{/if}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="chromeIcon"
						size="chromeIcon"
						aria-label="Database Manager"
						onclick={() => viewState.toggleSqlStudio()}
					>
						{#snippet children()}
							<HardDrives weight="fill" class="size-3.5" />
						{/snippet}
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>Database Manager</Tooltip.Content>
		</Tooltip.Root>
	{/snippet}
</AppTopBar>
