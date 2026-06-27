<script lang="ts">
	import { IconTerminal } from "../icons/index.js";
	import { IconPlug } from "../icons/index.js";
	import * as Dialog from "../dialog/index.js";
	import { StreamdownMarkdown } from "../streamdown-markdown/index.js";
	import { INLINE_ARTEFACT_PACKAGE_PATH } from "../inline-artefact-badge/inline-artefact-badge.styles.js";
	import AgentInputSlashCommandRow from "./agent-input-slash-command-row.svelte";
	import { getSlashCommandIconColor } from "./agent-input-slash-command-row-state.js";
	import {
		getEffectiveSlashCommandIndex,
		getFilteredSlashCommands,
		getNextSlashCommandIndex,
		getSlashCommandEmptyState,
		getSlashCommandWorkspaceMarkdown,
		type AgentInputSlashCommand,
		type AgentInputSlashCommandTokenType,
		type AgentInputSlashCommandWorkspaceMarkdownResult,
	} from "./agent-input-slash-command-dropdown-state.js";
	export type {
		AgentInputSlashCommand,
		AgentInputSlashCommandWorkspaceMarkdownResult,
	} from "./agent-input-slash-command-dropdown-state.js";

	interface Props {
		commands: ReadonlyArray<AgentInputSlashCommand>;
		isOpen: boolean;
		query: string;
		position: { top: number; left: number };
		headerLabel?: string;
		noCommandsLabel?: string;
		noResultsLabel?: string;
		startTypingLabel?: string;
		selectHintLabel?: string;
		closeHintLabel?: string;
		tokenType?: AgentInputSlashCommandTokenType;
		loadWorkspaceMarkdown?: (input: {
			readonly command: AgentInputSlashCommand;
			readonly tokenType: AgentInputSlashCommandTokenType;
		}) => Promise<AgentInputSlashCommandWorkspaceMarkdownResult>;
		onSelect: (command: AgentInputSlashCommand) => void;
		onClose: () => void;
	}

	let {
		commands,
		isOpen,
		query,
		position,
		headerLabel = "Commands",
		noCommandsLabel = "No commands available",
		noResultsLabel = "No matching commands",
		startTypingLabel = "Start typing to filter commands",
		selectHintLabel = "Select",
		closeHintLabel = "Close",
		tokenType = "command",
		loadWorkspaceMarkdown,
		onSelect,
		onClose,
	}: Props = $props();

	let selectedIndex = $state(0);
	let itemRefs = $state<Record<number, HTMLDivElement>>({});
	let workspaceCommand = $state<AgentInputSlashCommand | null>(null);
	let workspaceOpen = $state(false);
	let loadedWorkspaceMarkdown = $state<string | null>(null);
	let workspaceMarkdownLoading = $state(false);
	let workspaceMarkdownError = $state<string | null>(null);

	function portalToBody(node: HTMLElement): { destroy: () => void } {
		document.body.appendChild(node);

		return {
			destroy(): void {
				node.remove();
			},
		};
	}

	const filteredCommands = $derived(getFilteredSlashCommands(commands, query));
	const effectiveSelectedIndex = $derived(
		getEffectiveSlashCommandIndex({
			selectedIndex,
			commandCount: filteredCommands.length,
		})
	);
	const emptyState = $derived(
		getSlashCommandEmptyState({
			commandCount: commands.length,
			filteredCount: filteredCommands.length,
			query,
		})
	);
	const displayHeaderLabel = $derived(
		headerLabel === "Commands" && tokenType === "skill" ? "Skills" : headerLabel
	);
	const fallbackWorkspaceMarkdown = $derived(
		workspaceCommand
			? getSlashCommandWorkspaceMarkdown({
					command: workspaceCommand,
					tokenType,
				})
			: ""
	);
	const workspaceMarkdown = $derived(
		loadedWorkspaceMarkdown
			? `${fallbackWorkspaceMarkdown}\n\n---\n\n## Skill content\n\n${loadedWorkspaceMarkdown}`
			: fallbackWorkspaceMarkdown
	);
	const iconColor = $derived(getSlashCommandIconColor(tokenType));

	function scrollSelectedIntoView(): void {
		const item = itemRefs[effectiveSelectedIndex];
		if (item) {
			item.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}

	export function handleKeyDown(event: KeyboardEvent): boolean {
		if (!isOpen) {
			return false;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			selectedIndex = getNextSlashCommandIndex({
				currentIndex: effectiveSelectedIndex,
				commandCount: filteredCommands.length,
				direction: "down",
			});
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			selectedIndex = getNextSlashCommandIndex({
				currentIndex: effectiveSelectedIndex,
				commandCount: filteredCommands.length,
				direction: "up",
			});
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "Enter" || event.key === "Tab") {
			if (filteredCommands.length > 0) {
				event.preventDefault();
				onSelect(filteredCommands[effectiveSelectedIndex]);
				return true;
			}
			return false;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return true;
		}

		return false;
	}

	function openWorkspaceModal(command: AgentInputSlashCommand): void {
		workspaceCommand = command;
		loadedWorkspaceMarkdown = null;
		workspaceMarkdownError = null;
		workspaceOpen = true;
		if (!loadWorkspaceMarkdown || tokenType !== "skill") {
			return;
		}

		workspaceMarkdownLoading = true;
		loadWorkspaceMarkdown({ command, tokenType }).then(
			(result) => {
				if (workspaceCommand?.name !== command.name) {
					return;
				}
				workspaceMarkdownLoading = false;
				if (result.status === "ready") {
					loadedWorkspaceMarkdown = result.markdown;
					workspaceMarkdownError = null;
					return;
				}
				workspaceMarkdownError = result.message;
			},
			() => {
				if (workspaceCommand?.name !== command.name) {
					return;
				}
				workspaceMarkdownLoading = false;
				workspaceMarkdownError = "Unable to load full details.";
			}
		);
	}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portalToBody
		class="fixed z-[var(--overlay-z)] w-72 overflow-hidden rounded-lg border bg-popover/98 shadow-xl backdrop-blur"
		style="top: {position.top}px; left: {position.left}px; transform: translateY(-100%); margin-top: -6px;"
		onmousedown={(event) => event.preventDefault()}
	>
		{#if filteredCommands.length > 0}
			<div class="flex items-center justify-between border-b border-border/60 bg-muted/20 px-2.5 py-1 shrink-0">
				<div class="flex min-w-0 items-center gap-1.5">
					<span class="text-[11px] font-medium text-muted-foreground">{displayHeaderLabel}</span>
				</div>
				<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
					{filteredCommands.length}
				</span>
			</div>

			<div class="flex max-h-56 flex-col overflow-y-auto py-1">
				{#each filteredCommands as command, index (`${command.name}-${index}`)}
					{@const isSelected = index === effectiveSelectedIndex}
					<div bind:this={itemRefs[index]}>
						<AgentInputSlashCommandRow
							{command}
							{tokenType}
							selected={isSelected}
							showPreviewButton={tokenType === "skill"}
							onSelect={() => onSelect(command)}
							onPreview={() => openWorkspaceModal(command)}
							onHover={() => {
								selectedIndex = index;
							}}
						/>
					</div>
				{/each}
			</div>

			<div class="flex items-center gap-1.5 border-t border-border/60 bg-muted/20 px-2.5 py-1 shrink-0">
				<kbd class="rounded border bg-muted px-1 py-0.5 text-[10px] font-medium leading-none">Enter</kbd>
				<span class="text-[10px] text-muted-foreground">{selectHintLabel}</span>
				<kbd class="ml-1 rounded-lg border bg-muted px-1 py-0.5 text-[10px] font-medium leading-none">Esc</kbd>
				<span class="text-[10px] text-muted-foreground">{closeHintLabel}</span>
			</div>
		{:else if emptyState === "no-commands"}
			<div class="px-3 py-3 text-center text-[12px] text-muted-foreground">{noCommandsLabel}</div>
		{:else if emptyState === "no-results"}
			<div class="px-3 py-3 text-center text-[12px] text-muted-foreground">{noResultsLabel}</div>
		{:else}
			<div class="flex items-center justify-between border-b border-border/60 bg-muted/20 px-2.5 py-1 shrink-0">
				<span class="text-[11px] font-medium text-muted-foreground">{displayHeaderLabel}</span>
			</div>
			<div class="px-3 py-3 text-center text-[12px] text-muted-foreground">{startTypingLabel}</div>
		{/if}
	</div>
{/if}

<Dialog.Root bind:open={workspaceOpen}>
	<Dialog.Content
		class="max-h-[82vh] max-w-2xl overflow-hidden p-0"
		style="z-index: calc(var(--overlay-z) + 10);"
		showCloseButton={true}
	>
		<div class="border-b border-border/60 px-4 py-3">
			<Dialog.Title class="flex items-center gap-2 text-sm">
				<span class="flex h-5 w-5 items-center justify-center rounded-md" style="color: {iconColor};">
					{#if tokenType === "skill"}
						<svg viewBox="0 0 256 256" fill="currentColor" class="h-3 w-3" aria-hidden="true">
							<path d={INLINE_ARTEFACT_PACKAGE_PATH} />
						</svg>
					{:else if tokenType === "mcp"}
						<IconPlug class="h-3 w-3" />
					{:else}
						<IconTerminal class="h-3 w-3" />
					{/if}
				</span>
				{workspaceCommand ? `/${workspaceCommand.name}` : "Details"}
			</Dialog.Title>
			<Dialog.Description class="mt-1">
				Readable workspace preview with markdown and highlighted code blocks.
			</Dialog.Description>
		</div>
		<div class="max-h-[68vh] overflow-y-auto px-4 py-3">
			{#if workspaceMarkdownLoading}
				<div class="mb-3 text-[11px] text-muted-foreground">Loading full skill content...</div>
			{/if}
			{#if workspaceMarkdownError}
				<div class="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
					{workspaceMarkdownError}
				</div>
			{/if}
			<StreamdownMarkdown
				markdown={workspaceMarkdown}
				mode="static"
				class="text-[12px] leading-relaxed"
			/>
		</div>
	</Dialog.Content>
</Dialog.Root>
