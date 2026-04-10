<script lang="ts">
import TerminalPanelHeader from "../../terminal-panel-header.svelte";
import type { TerminalTab } from "$lib/acp/store/types.js";

interface Props {
	projectName: string;
	projectColor: string | undefined;
	shell: string | null;
	onClose: () => void;
	tabs?: readonly TerminalTab[];
	selectedTabId?: string | null;
	onSelectTab?: (id: string) => void;
	onNewTab?: () => void;
	onCloseTab?: (id: string) => void;
	onMoveTabToNewPanel?: (id: string) => void;
	canMoveTabToNewPanel?: (id: string) => boolean;
}

let {
	projectName,
	projectColor,
	shell,
	onClose,
	tabs,
	selectedTabId,
	onSelectTab,
	onNewTab,
	onCloseTab,
	onMoveTabToNewPanel,
	canMoveTabToNewPanel,
}: Props = $props();
</script>

<TerminalPanelHeader
	{projectName}
	{projectColor}
	{shell}
	{onClose}
	{tabs}
	{selectedTabId}
	{onSelectTab}
	{onNewTab}
	{onCloseTab}
	{onMoveTabToNewPanel}
	{canMoveTabToNewPanel}
/>
