<script lang="ts">
import {
	Button,
	LayoutModeIcon,
	PaletteIcon,
	RoundedIcon,
	SegmentedToggleGroup,
	Selector,
	StorageIcon,
	UsageLimitWidget,
	WrenchIcon,
} from "@acepe/ui";
import { COLOR_NAMES, Colors } from "@acepe/ui/colors";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { AppTopBar } from "@acepe/ui/app-layout";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { onMount, type Snippet } from "svelte";
import { getPanelStore, getSessionStore } from "$lib/acp/store/index.js";
import type { ViewMode } from "$lib/acp/store/types.js";
import type { MainAppViewState } from "$lib/components/main-app-view/logic/main-app-view-state.svelte.js";
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
import { createProviderUsageRefreshScheduler } from "./provider-usage-refresh-scheduler.js";
interface Props {
	viewState: MainAppViewState;
	/** Optional snippet for add project/repository button (e.g. dropdown). Rendered in top bar left after decorations. */
	addProjectButton?: Snippet;
	onDevShowUpdatePage?: () => void;
	onDevShowDesignSystem?: () => void;
	onDevShowStreamingReproLab?: () => void;
	onDevResetOnboarding?: () => void;
	showSidebarToggle?: boolean;
}

let {
	viewState,
	addProjectButton,
	onDevShowUpdatePage,
	onDevShowDesignSystem,
	onDevShowStreamingReproLab,
	onDevResetOnboarding,
	showSidebarToggle = true,
}: Props = $props();

const panelStore = getPanelStore();
const sessionStore = getSessionStore();
const themeState = useTheme();
const USAGE_REFRESH_INTERVAL_MS = 60_000;
const USAGE_EVENT_REFRESH_DEBOUNCE_MS = 250;
const USAGE_STARTUP_READY_POLL_MS = 50;
const USAGE_INITIAL_REFRESH_DELAY_MS = 250;
const PROVIDER_ACCOUNT_USAGE_UPDATED_EVENT = "provider-account-usage://updated";
let providerUsageAccounts = $state.raw<ReadonlyArray<UsageProviderAccount>>(
	buildProviderUsageCheckingAccounts()
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
	const providerUsageScheduler = createProviderUsageRefreshScheduler({
		isStartupReady: () => viewState.initializationComplete,
		refresh: refreshProviderUsageAccounts,
		setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
		clearTimeout: (id) => window.clearTimeout(id),
		setInterval: (callback, delayMs) => window.setInterval(callback, delayMs),
		clearInterval: (id) => window.clearInterval(id),
		startupPollMs: USAGE_STARTUP_READY_POLL_MS,
		initialDelayMs: USAGE_INITIAL_REFRESH_DELAY_MS,
		eventDebounceMs: USAGE_EVENT_REFRESH_DEBOUNCE_MS,
		refreshIntervalMs: USAGE_REFRESH_INTERVAL_MS,
	});

	providerUsageScheduler.start();
	void listen(PROVIDER_ACCOUNT_USAGE_UPDATED_EVENT, () => {
		providerUsageScheduler.notifyUsageUpdated();
	}).then((unlisten) => {
		if (disposed) {
			void unlisten();
			return;
		}
		quotaUpdateUnlisten = unlisten;
	});

	return () => {
		disposed = true;
		providerUsageScheduler.dispose();
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
	sidebarOpen={viewState.sidebarOpen}
	showAddProject={!!addProjectButton}
	{addProjectButton}
	onToggleSidebar={() => viewState.setSidebarOpen(!viewState.sidebarOpen)}
	onSettings={() => viewState.toggleSettings()}
	showAvatar={false}
	showSearch={false}
	showRightSectionLeadingBorder={panelStore.viewMode !== "kanban"}
>
	{#snippet extraRightActions()}
		{#snippet layoutControl()}
			<Selector
				align="end"
				variant="ghost"
				triggerSize="chromeIcon"
				showChevron={false}
				tooltipLabel="Layout"
				triggerAriaLabel="Layout Settings"
			>
				{#snippet renderButton()}
					<RoundedIcon name="filter" />
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
									<RoundedIcon
										name="check"
										class={selected
											? "mt-0.5 size-3 shrink-0 text-foreground"
											: "mt-0.5 size-3 shrink-0 text-transparent"}
									/>
									{#if family.value === "kanban"}
										<LayoutModeIcon
											mode="kanban"
											color={family.color}
											class="mt-0.5 size-3"
											data-testid="top-bar-kanban-layout-icon"
										/>
									{:else}
										<LayoutModeIcon
											mode="grid"
											color={family.color}
											class="mt-0.5 size-3"
											data-testid="top-bar-standard-layout-icon"
										/>
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
										<RoundedIcon
											name="check"
											class={selected
												? "mt-0.5 size-3 shrink-0 text-foreground"
												: "mt-0.5 size-3 shrink-0 text-transparent"}
										/>
										{#if mode.value === "single"}
											<span
												class="mt-0.5 size-3 shrink-0 rounded-sm"
												style:background-color={mode.color}
												data-testid="layout-single-mode-swatch"
											></span>
										{:else if mode.value === "project"}
											<LayoutModeIcon
												mode="columns"
												color={mode.color}
												class="mt-0.5 size-3"
												data-testid="top-bar-project-layout-icon"
											/>
										{:else}
											<LayoutModeIcon
												mode="grid"
												color={mode.color}
												class="mt-0.5 size-3"
												data-testid="top-bar-multi-layout-icon"
											/>
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
						variant="ghost"
						size="icon-2xs"
						aria-label="Feedback"
						onclick={() => openUrl("https://github.com/flazouh/acepe/issues")}
					>
						{#snippet children()}
							<RoundedIcon name="bug" style="color: #FF5D5A" />
						{/snippet}
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>Feedback</Tooltip.Content>
		</Tooltip.Root>
		{#if import.meta.env.DEV && (onDevShowUpdatePage || onDevShowDesignSystem || onDevShowStreamingReproLab || onDevResetOnboarding)}
			<Selector
				align="end"
				variant="ghost"
				triggerSize="chromeIcon"
				showChevron={false}
				tooltipLabel="Dev Tools"
				triggerAriaLabel="Dev Tools"
			>
				{#snippet renderButton()}
					<WrenchIcon weight="fill" style="color: #FAD83C" />
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
								<RoundedIcon name="download" class="size-4" />
								<span>Update Page</span>
							</DropdownMenu.Item>
						{/if}
						{#if onDevShowDesignSystem}
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevShowDesignSystem}
							>
								<PaletteIcon class="size-4" weight="fill" />
								<span>Design System</span>
							</DropdownMenu.Item>
						{/if}
						{#if onDevShowStreamingReproLab}
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevShowStreamingReproLab}
							>
								<WrenchIcon class="size-4" weight="fill" />
								<span>Streaming Repro Lab</span>
							</DropdownMenu.Item>
						{/if}
						{#if onDevResetOnboarding}
							<DropdownMenu.Item
								class="cursor-pointer rounded-none px-2 py-1 text-[11px]"
								onclick={onDevResetOnboarding}
							>
								<WrenchIcon class="size-4" weight="fill" />
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
						variant="ghost"
						size="icon-2xs"
						aria-label="Database Manager"
						onclick={() => viewState.toggleSqlStudio()}
					>
						{#snippet children()}
							<StorageIcon weight="fill" />
						{/snippet}
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>Database Manager</Tooltip.Content>
		</Tooltip.Root>
	{/snippet}
</AppTopBar>
