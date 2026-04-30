<script lang="ts">
	import {
		BrowserNavActions,
		CloseAction,
		EmbeddedPanelHeader,
		HeaderActionCell,
		HeaderTitleCell,
	} from "../panel-header/index.js";

	interface Props {
		url: string;
		backLabel: string;
		forwardLabel: string;
		reloadLabel: string;
		openExternalLabel: string;
		closeLabel: string;
		onBack?: () => void;
		onForward?: () => void;
		onReload?: () => void;
		onNavigate?: (url: string) => void;
		onOpenExternal?: () => void;
		onClose?: () => void;
	}

	let props: Props = $props();

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
		props.onNavigate?.(normalizedUrl);
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
			backLabel={props.backLabel}
			forwardLabel={props.forwardLabel}
			reloadLabel={props.reloadLabel}
		/>
	</HeaderActionCell>

	<HeaderTitleCell class="min-w-0 px-2" compactPadding>
		<form class="flex min-w-0 w-full items-center" onsubmit={handleSubmit}>
			<input
				name="browser-url"
				type="text"
				value={inputValue}
				class="h-5 min-w-0 flex-1 bg-transparent text-sm font-mono text-foreground outline-none placeholder:text-muted-foreground/70"
				autocapitalize="off"
				autocomplete="off"
				spellcheck="false"
				title={lastSyncedUrl}
				oninput={(event) => updateInputValue((event.currentTarget as HTMLInputElement).value)}
			/>
		</form>
	</HeaderTitleCell>

	<HeaderActionCell class="overflow-hidden" withDivider={true}>
		<BrowserNavActions
			onOpenExternal={props.onOpenExternal}
			openExternalLabel={props.openExternalLabel}
			showNavigation={false}
			showExternal={true}
		/>
		<CloseAction onClose={props.onClose} title={props.closeLabel} />
	</HeaderActionCell>
</EmbeddedPanelHeader>
