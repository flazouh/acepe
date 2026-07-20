<script lang="ts">
import {
	type AppTab,
	AppTabBarTab,
	type AppTabMode,
	type AppTabStatus,
} from "@acepe/ui/app-layout";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { getProviderBrandIcon } from "../../constants/thread-list-constants.js";
import { getAgentStore } from "../../store/index.js";
import type { TabBarTab } from "../../store/tab-bar-utils.js";
import { deriveAppTabStatus } from "./tab-bar-status.js";

interface Props {
	/** Tabs sorted by project sortOrder ascending */
	tabs: readonly TabBarTab[];
	/** Callback when a tab is selected */
	onSelectTab: (panelId: string) => void;
	/** Callback when a tab is closed */
	onCloseTab: (panelId: string) => void;
	/** Stronger focused tab treatment for single-panel/fullscreen layouts. */
	activeContrast?: "normal" | "strong";
	/** Global disambiguating badge labels keyed by project path. */
	badgeLabelByPath?: ReadonlyMap<string, string>;
}

let {
	tabs,
	onSelectTab,
	onCloseTab,
	activeContrast = "normal",
	badgeLabelByPath,
}: Props = $props();

const themeState = useTheme();
const agentStore = getAgentStore();

function resolveProviderIcon(agentId: string | null | undefined): string | undefined {
	if (!agentId) {
		return undefined;
	}

	const providerBrand = agentStore.getProviderMetadata(agentId)?.providerBrand ?? null;

	return getProviderBrandIcon(providerBrand, themeState.effectiveTheme) ?? undefined;
}

function tabToAppTab(tab: TabBarTab): AppTab {
	const status: AppTabStatus = deriveAppTabStatus(tab);

	const mode: AppTabMode = tab.currentModeId ?? null;

	return {
		id: tab.panelId,
		title: tab.title ?? "New Thread",
		projectName: tab.projectName ?? undefined,
		projectBadgeLabel: tab.projectPath ? (badgeLabelByPath?.get(tab.projectPath) ?? null) : null,
		projectColor: tab.projectColor ?? undefined,
		projectIconSrc: tab.projectIconSrc,
		sequenceId: tab.sequenceId,
		agentIconSrc: resolveProviderIcon(tab.agentId),
		mode,
		status,
		isFocused: tab.isFocused,
		tooltipText: tab.conversationPreview?.[0]?.text,
	};
}
</script>

{#if tabs.length > 0}
	<div class="flex items-center gap-0.5 overflow-x-auto" role="tablist">
		{#each tabs as tab (tab.panelId)}
			<AppTabBarTab
				tab={tabToAppTab(tab)}
				{activeContrast}
				onclick={() => onSelectTab(tab.panelId)}
				onclose={() => onCloseTab(tab.panelId)}
			/>
		{/each}
	</div>
{/if}
