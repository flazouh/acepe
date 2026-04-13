<script lang="ts">
import {
	type AppTab,
	AppTabBarGrouped,
	AppTabBarTab,
	type AppTabMode,
	type AppTabStatus,
} from "@acepe/ui/app-layout";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import * as m from "$lib/messages.js";
import { getAgentIcon } from "../../constants/thread-list-constants.js";
import type { TabBarTab, TabBarTabGroup } from "../../store/tab-bar-utils.js";
import { CanonicalModeId } from "../../types/canonical-mode-id.js";
import { deriveAppTabStatus } from "./tab-bar-status.js";

interface Props {
	/** Tabs grouped by project */
	groupedTabs: TabBarTabGroup[];
	/** Callback when a tab is selected */
	onSelectTab: (panelId: string) => void;
	/** Callback when a tab is closed */
	onCloseTab: (panelId: string) => void;
}

let { groupedTabs, onSelectTab, onCloseTab }: Props = $props();

const themeState = useTheme();

function tabToAppTab(tab: TabBarTab): AppTab {
	const status: AppTabStatus = deriveAppTabStatus(tab);

	let mode: AppTabMode = null;
	if (tab.currentModeId === CanonicalModeId.PLAN) mode = "plan";
	else if (tab.currentModeId) mode = "build";

	return {
		id: tab.panelId,
		title: tab.title ?? m.agent_panel_new_thread(),
		projectName: tab.projectName ?? undefined,
		projectColor: tab.projectColor ?? undefined,
		agentIconSrc: tab.agentId ? getAgentIcon(tab.agentId, themeState.effectiveTheme) : undefined,
		mode,
		status,
		isFocused: tab.isFocused,
		tooltipText: tab.conversationPreview[0]?.text,
	};
}

/** Map desktop groups to the shape AppTabBarGrouped expects, resolving colors */
const resolvedGroups = $derived(groupedTabs);
</script>

{#if groupedTabs.length > 0}
	<AppTabBarGrouped groups={resolvedGroups}>
		{#snippet tabRenderer(tab: TabBarTab)}
			<AppTabBarTab
				tab={tabToAppTab(tab)}
				hideProjectBadge={true}
				onclick={() => onSelectTab(tab.panelId)}
				onclose={() => onCloseTab(tab.panelId)}
			/>
		{/snippet}
	</AppTabBarGrouped>
{/if}
