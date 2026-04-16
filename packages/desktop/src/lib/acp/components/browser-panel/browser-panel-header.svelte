<script lang="ts">
import { AgentPanelBrowserHeader as SharedAgentPanelBrowserHeader } from "@acepe/ui/agent-panel";
import * as m from "$lib/messages.js";

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
	backLabel={m.link_preview_back()}
	forwardLabel={m.link_preview_forward()}
	reloadLabel={m.link_preview_refresh()}
	openExternalLabel={m.link_preview_open_browser()}
	closeLabel={m.common_close()}
	{onBack}
	{onForward}
	{onReload}
	{onNavigate}
	{onOpenExternal}
	{onClose}
/>
