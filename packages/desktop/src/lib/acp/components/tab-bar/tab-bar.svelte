<script lang="ts">
import { type AppTab, AppTabBarTab, type AppTabMode, type AppTabStatus } from "@acepe/ui/app-layout";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { getAgentIcon } from "../../constants/thread-list-constants.js";
import type { TabBarTab } from "../../store/tab-bar-utils.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { deriveAppTabStatus } from "./tab-bar-status.js";

interface Props {
	/** Tabs sorted by project sortOrder ascending */
	tabs: readonly TabBarTab[];
	/** Callback when a tab is selected */
	onSelectTab: (panelId: string) => void;
	/** Callback when a tab is closed */
	onCloseTab: (panelId: string) => void;
}

let { tabs, onSelectTab, onCloseTab }: Props = $props();

const themeState = useTheme();

function tabToAppTab(tab: TabBarTab): AppTab {
	const status: AppTabStatus = deriveAppTabStatus(tab);

	let mode: AppTabMode = null;
	if (tab.currentModeId === CanonicalModeId.PLAN) mode = "plan";
	else if (tab.currentModeId) mode = "build";

	return {
		id: tab.panelId,
		title: tab.title ?? "New Thread",
		projectName: tab.projectName ?? undefined,
		projectColor: tab.projectColor ?? undefined,
		projectIconSrc: tab.projectIconSrc,
		sequenceId: tab.sequenceId,
		agentIconSrc: tab.agentId ? getAgentIcon(tab.agentId, themeState.effectiveTheme) : undefined,
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
				onclick={() => onSelectTab(tab.panelId)}
				onclose={() => onCloseTab(tab.panelId)}
			/>
		{/each}
	</div>
{/if}
