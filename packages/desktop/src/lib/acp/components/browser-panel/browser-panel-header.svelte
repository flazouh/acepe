<script lang="ts">
import { AgentPanelBrowserHeader as SharedAgentPanelBrowserHeader } from "@acepe/ui/agent-panel";
interface Props {
	url: string;
	onBack?: () => void;
	onForward?: () => void;
	onReload?: () => void;
	onNavigate?: (url: string) => void;
	onOpenExternal?: () => void;
	onClose?: () => void;
}

let { url, onBack, onForward, onReload, onNavigate, onOpenExternal, onClose }: Props = $props();
</script>

<SharedAgentPanelBrowserHeader
	{url}
	backLabel={"Go back"}
	forwardLabel={"Go forward"}
	reloadLabel={"Refresh"}
	openExternalLabel={"Open in browser"}
	closeLabel={"Close"}
	{onBack}
	{onForward}
	{onReload}
	{onNavigate}
	{onOpenExternal}
	{onClose}
/>
