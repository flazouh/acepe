<script lang="ts">
	import { IconTerminal } from "@tabler/icons-svelte";
	import { IconPlug } from "@tabler/icons-svelte";
	import { BookOpenText } from "phosphor-svelte";
	import { INLINE_ARTEFACT_PACKAGE_PATH } from "../inline-artefact-badge/inline-artefact-badge.styles.js";
	import {
		getSlashCommandDisplayName,
		getSlashCommandIconColor,
	} from "./agent-input-slash-command-row-state.js";
	import {
		getSlashCommandMetaLabel,
		type AgentInputSlashCommand,
		type AgentInputSlashCommandTokenType,
	} from "./agent-input-slash-command-dropdown-state.js";

	interface Props {
		command: AgentInputSlashCommand;
		tokenType: AgentInputSlashCommandTokenType;
		selected?: boolean;
		showPreviewButton?: boolean;
		onSelect?: () => void;
		onPreview?: () => void;
		onHover?: () => void;
	}

	let {
		command,
		tokenType,
		selected = false,
		showPreviewButton = false,
		onSelect,
		onPreview,
		onHover,
	}: Props = $props();

	const iconColor = $derived(getSlashCommandIconColor(tokenType));
	const displayName = $derived(getSlashCommandDisplayName(command.name, tokenType));
	const metaLabel = $derived(getSlashCommandMetaLabel({ command, tokenType }));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="mx-1.5 flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 {selected
		? 'bg-accent text-accent-foreground'
		: 'hover:bg-accent/50'}"
	title={command.description}
	onclick={() => onSelect?.()}
	onmouseenter={() => onHover?.()}
>
	<div
		class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]"
		style="color: {iconColor};"
	>
		{#if tokenType === "skill"}
			<svg viewBox="0 0 256 256" fill="currentColor" class="h-2.5 w-2.5" aria-hidden="true">
				<path d={INLINE_ARTEFACT_PACKAGE_PATH} />
			</svg>
		{:else if tokenType === "mcp"}
			<IconPlug class="h-2.5 w-2.5" />
		{:else}
			<IconTerminal class="h-2.5 w-2.5" />
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<div class="flex min-w-0 items-baseline gap-1.5">
			<span
				class="min-w-0 truncate text-[12px] font-medium leading-4 {tokenType === 'skill'
					? ''
					: 'font-mono'}"
			>
				{displayName}
			</span>
		</div>
		{#if tokenType !== "skill" && command.description.trim().length > 0}
			<div class="truncate text-[11px] leading-4 text-muted-foreground">
				{command.description}
			</div>
		{/if}
		{#if tokenType !== "skill"}
			<div class="truncate text-[10px] leading-3 text-muted-foreground/70">
				{metaLabel}
			</div>
		{/if}
	</div>
	{#if showPreviewButton}
		<button
			type="button"
			class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
			title="Open readable details"
			aria-label="Open readable details for {displayName}"
			onclick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onPreview?.();
			}}
		>
			<BookOpenText weight="fill" class="h-3 w-3" />
		</button>
	{/if}
</div>
