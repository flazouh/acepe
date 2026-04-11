<script lang="ts">
	import type { Snippet } from "svelte";

	import AgentPanelFooterChrome from "./agent-panel-footer-chrome.svelte";

	interface Props {
		left?: Snippet;
		showTrailingBorder?: boolean;
		onSettings?: (() => void) | undefined;
		settingsTitle?: string;
		settingsAriaLabel?: string;
		showBrowserToggle?: boolean;
		browserActive?: boolean;
		browserTitle?: string;
		browserAriaLabel?: string;
		onToggleBrowser?: () => void;
		showTerminalToggle?: boolean;
		terminalActive?: boolean;
		terminalDisabled?: boolean;
		terminalTitle?: string;
		terminalAriaLabel?: string;
		onToggleTerminal?: () => void;
	}

	let {
		left,
		showTrailingBorder = false,
		onSettings,
		settingsTitle,
		settingsAriaLabel,
		showBrowserToggle = true,
		browserActive = false,
		browserTitle = "",
		browserAriaLabel,
		onToggleBrowser,
		showTerminalToggle = true,
		terminalActive = false,
		terminalDisabled = false,
		terminalTitle = "",
		terminalAriaLabel,
		onToggleTerminal,
	}: Props = $props();
</script>

<AgentPanelFooterChrome
	{showTrailingBorder}
	{onSettings}
	{settingsTitle}
	{settingsAriaLabel}
	{showBrowserToggle}
	{browserActive}
	{browserTitle}
	{browserAriaLabel}
	{onToggleBrowser}
	{showTerminalToggle}
	{terminalActive}
	{terminalDisabled}
	{terminalTitle}
	{terminalAriaLabel}
	{onToggleTerminal}
>
	{#if left}
		{#snippet left()}
			{@render left()}
		{/snippet}
	{/if}
</AgentPanelFooterChrome>
