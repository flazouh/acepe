<script lang="ts">
import {
	BrowserNavActions,
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import * as m from "$lib/paraglide/messages.js";

interface Props {
	url: string;
	onBack: () => void;
	onForward: () => void;
	onReload: () => void;
	onNavigate: (url: string) => void;
	onOpenExternal: () => void;
	onClose: () => void;
}
const props: Props = $props();

let inputValue = $state(props.url);
let lastSyncedUrl = $state(props.url);

function updateInputValue(value: string): void {
	inputValue = value;
}

function handleSubmit(event: Event): void {
	event.preventDefault();
	const trimmedValue = inputValue.trim();
	if (!trimmedValue) {
		return;
	}
	const normalizedUrl =
		trimmedValue.startsWith("http://") || trimmedValue.startsWith("https://")
			? trimmedValue
			: `https://${trimmedValue}`;
	lastSyncedUrl = normalizedUrl;
	props.onNavigate(normalizedUrl);
	inputValue = normalizedUrl;
}

$effect(() => {
	if (props.url !== lastSyncedUrl) {
		lastSyncedUrl = props.url;
		inputValue = props.url;
	}
});
</script>

<EmbeddedPanelHeader class="bg-background border-b border-border shrink-0">
	<HeaderActionCell withDivider={false}>
		<BrowserNavActions
			onBack={props.onBack}
			onForward={props.onForward}
			onReload={props.onReload}
			backLabel={m.link_preview_back()}
			forwardLabel={m.link_preview_forward()}
			reloadLabel={m.link_preview_refresh()}
		/>
	</HeaderActionCell>

	<HeaderTitleCell class="min-w-0 px-2" compactPadding>
		<form class="flex items-center min-w-0 w-full" onsubmit={handleSubmit}>
			<input
				name="browser-url"
				type="text"
				value={inputValue}
				class="h-5 min-w-0 flex-1 bg-transparent text-[11px] font-mono text-foreground outline-none placeholder:text-muted-foreground/70"
				autocapitalize="off"
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				title={lastSyncedUrl}
				oninput={(event) => updateInputValue((event.currentTarget as HTMLInputElement).value)}
			/>
		</form>
	</HeaderTitleCell>

	<HeaderActionCell class="overflow-hidden" withDivider={true}>
		<BrowserNavActions
			onOpenExternal={props.onOpenExternal}
			openExternalLabel={m.link_preview_open_browser()}
			showNavigation={false}
			showExternal={true}
		/>
		<CloseAction onClose={props.onClose} title={m.common_close()} />
	</HeaderActionCell>
</EmbeddedPanelHeader>
