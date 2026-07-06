<script lang="ts">
	import type { Snippet } from "svelte";

	import { Button } from "../button/index.js";
	import { RoundedIcon } from "../icons/index.js";

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
	class="shrink-0 flex items-center border-t border-border/50 bg-card/50 {showTrailingBorder
		? 'border-r border-border/50'
		: ''}"
>
	{#if left}
		{@render left()}
	{/if}

	{#if onSettings}
		<div class="flex items-center gap-0.5 px-1.5">
			<Button
				variant="ghost"
				size="icon"
				data-header-control
				title={settingsTitle}
				aria-label={settingsAriaLabel ?? settingsTitle}
				onclick={onSettings}
			>
				{#snippet children()}
					<RoundedIcon name="settings" />
				{/snippet}
			</Button>
		</div>
	{/if}

	{#if showBrowserToggle || showTerminalToggle}
		<div class="ml-auto flex items-center gap-0.5 px-1.5">
			{#if showBrowserToggle}
				<Button
					variant="ghost"
					size="icon"
					data-header-control
					active={browserActive}
					title={browserTitle}
					aria-label={browserAriaLabel ?? browserTitle}
					onclick={onToggleBrowser}
				>
					{#snippet children()}
						<RoundedIcon name="browser" />
					{/snippet}
				</Button>
			{/if}
			{#if showTerminalToggle}
				<Button
					variant="ghost"
					size="icon"
					data-header-control
					active={terminalActive}
					disabled={terminalDisabled}
					title={terminalTitle}
					aria-label={terminalAriaLabel ?? terminalTitle}
					onclick={onToggleTerminal}
				>
					{#snippet children()}
						<RoundedIcon name="terminal" />
					{/snippet}
				</Button>
			{/if}
		</div>
	{/if}
</div>
