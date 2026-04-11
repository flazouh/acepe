<script lang="ts">
	import type { Snippet } from "svelte";

	import { Browser } from "phosphor-svelte";
	import { Gear } from "phosphor-svelte";
	import { Terminal } from "phosphor-svelte";
	import { EmbeddedIconButton } from "../panel-header/index.js";

	interface Props {
		children?: Snippet;
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
		children: _children,
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

<div
	class="shrink-0 flex items-center h-7 border-t border-border/50 bg-card/50 {showTrailingBorder
		? 'border-r border-border/50'
		: ''}"
>
	{#if left}
		{@render left()}
	{/if}

	{#if onSettings}
		<div class="flex items-center border-l border-border/50">
			<EmbeddedIconButton
				title={settingsTitle}
				ariaLabel={settingsAriaLabel ?? settingsTitle}
				onclick={onSettings}
			>
				<Gear class="h-3.5 w-3.5" weight="fill" />
			</EmbeddedIconButton>
		</div>
	{/if}

	{#if showBrowserToggle || showTerminalToggle}
		<div class="ml-auto flex items-center border-l border-border/50">
			{#if showBrowserToggle}
				<EmbeddedIconButton
					active={browserActive}
					title={browserTitle}
					ariaLabel={browserAriaLabel ?? browserTitle}
					onclick={onToggleBrowser}
				>
					<Browser class="h-3.5 w-3.5" weight={browserActive ? "fill" : "regular"} />
				</EmbeddedIconButton>
			{/if}
			{#if showTerminalToggle}
				<EmbeddedIconButton
					active={terminalActive}
					disabled={terminalDisabled}
					title={terminalTitle}
					ariaLabel={terminalAriaLabel ?? terminalTitle}
					onclick={onToggleTerminal}
				>
					<Terminal class="h-3.5 w-3.5" weight="fill" />
				</EmbeddedIconButton>
			{/if}
		</div>
	{/if}
</div>
