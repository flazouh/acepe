<script lang="ts">
	import { AgentSelectorView, type AgentSelectorViewItem, type ButtonVariant } from "@acepe/ui";
	import { useTheme } from "$lib/components/theme/context.svelte.js";
	import * as m from "$lib/messages.js";
	import { getAgentIcon } from "../constants/thread-list-constants.js";
	import type { AgentInfo } from "../logic/agent-manager.js";
	import { getAgentPreferencesStore } from "../store/index.js";
	import { capitalizeName } from "../utils/index.js";
	import { createLogger } from "../utils/logger.js";

	interface AgentSelectorProps {
		availableAgents: AgentInfo[];
		currentAgentId: string | null;
		onAgentChange: (agentId: string) => void;
		isLoading?: boolean;
		ontoggle?: (isOpen: boolean) => void;
		class?: string;
		buttonClass?: string;
		contentClass?: string;
		showChevron?: boolean;
		variant?: ButtonVariant;
	}

	let {
		availableAgents,
		currentAgentId,
		onAgentChange,
		isLoading = false,
		ontoggle,
		class: className = "",
		buttonClass = "",
		contentClass = "",
		showChevron = true,
		variant = "outline",
	}: AgentSelectorProps = $props();

	let viewRef: { toggle: () => void } | undefined = $state();
	let isDropdownOpen = $state(false);

	const logger = createLogger({
		id: "agent-selector" as const,
		name: "Agent Selector",
	});

	const themeState = useTheme();
	const agentPreferencesStore = getAgentPreferencesStore();
	const defaultAgentId = $derived(agentPreferencesStore.defaultAgentId);

	const agentItems = $derived<readonly AgentSelectorViewItem[]>(
		availableAgents.map((agent) => ({
			id: agent.id,
			name: capitalizeName(agent.name),
			iconSrc: getAgentIcon(agent.id, themeState.effectiveTheme) ?? null,
			isFavorite: agent.id === defaultAgentId,
		}))
	);

	function handleAgentSelect(agentId: string) {
		logger.debug("handleAgentSelect() called", {
			agentId,
			currentAgentId,
			isDifferent: agentId !== currentAgentId,
		});

		if (agentId !== currentAgentId) {
			logger.info("Changing agent", { from: currentAgentId, to: agentId });
			onAgentChange(agentId);
		}
		isDropdownOpen = false;
	}

	function handleToggleFavorite(agentId: string, nextFavorite: boolean) {
		void agentPreferencesStore.setDefaultAgentId(nextFavorite ? agentId : null);
	}

	export function toggle() {
		viewRef?.toggle();
	}

	function handleOpenChange(open: boolean) {
		isDropdownOpen = open;
		ontoggle?.(open);
	}
</script>

<AgentSelectorView
	bind:this={viewRef}
	bind:open={isDropdownOpen}
	agents={agentItems}
	selectedAgentId={currentAgentId}
	disabled={availableAgents.length === 0}
	{isLoading}
	class={className}
	{buttonClass}
	{contentClass}
	{showChevron}
	{variant}
	emptyLabel={m.agent_selector_no_agents()}
	onSelect={handleAgentSelect}
	onToggleFavorite={handleToggleFavorite}
	onOpenChange={handleOpenChange}
/>
