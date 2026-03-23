<script lang="ts">
import {
	BrowserNavActions,
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import IconWorld from "@tabler/icons-svelte/icons/world";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	url: string;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onOpenExternal: () => void;
	onClose: () => void;
}

let { url, onBack, onForward, onReload, onOpenExternal, onClose }: Props = $props();

function getDomain(urlString: string): string {
	try {
		return new URL(urlString).hostname;
	} catch {
		return urlString;
	}
}
</script>

<EmbeddedPanelHeader>
	<HeaderActionCell withDivider={false}>
		<BrowserNavActions
			{onBack}
			{onForward}
			onReload={onReload}
			backLabel={m.link_preview_back()}
			forwardLabel={m.link_preview_forward()}
			reloadLabel={m.link_preview_refresh()}
		/>
	</HeaderActionCell>

	<HeaderTitleCell>
		<div class="flex items-center gap-1.5 min-w-0">
			<IconWorld class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
			<span class="text-[11px] text-muted-foreground truncate font-mono" title={url}>
				{getDomain(url)}
			</span>
		</div>
	</HeaderTitleCell>

	<HeaderActionCell withDivider={true}>
		<BrowserNavActions
			onOpenExternal={onOpenExternal}
			openExternalLabel={m.link_preview_open_browser()}
			showNavigation={false}
			showExternal={true}
		/>
		<CloseAction onClose={onClose} title={m.common_close()} />
	</HeaderActionCell>
</EmbeddedPanelHeader>
