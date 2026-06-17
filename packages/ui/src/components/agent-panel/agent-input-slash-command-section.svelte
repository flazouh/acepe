<script lang="ts">
	import AgentInputSlashCommandRow from "./agent-input-slash-command-row.svelte";
	import type {
		AgentInputSlashCommand,
		AgentInputSlashCommandTokenType,
	} from "./agent-input-slash-command-dropdown-state.js";

	interface Props {
		label: string;
		count: number;
		commands: ReadonlyArray<AgentInputSlashCommand>;
		tokenType: AgentInputSlashCommandTokenType;
		showPreviewButton?: boolean;
		onSelect?: (command: AgentInputSlashCommand) => void;
		onPreview?: (command: AgentInputSlashCommand) => void;
	}

	let {
		label,
		count,
		commands,
		tokenType,
		showPreviewButton = false,
		onSelect,
		onPreview,
	}: Props = $props();
</script>

<div class="border-t border-border/60 first:border-t-0">
	<div class="flex items-center justify-between bg-muted/20 px-2.5 py-1">
		<span class="text-[11px] font-medium text-muted-foreground">{label}</span>
		<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
			{count}
		</span>
	</div>
	<div class="flex max-h-40 flex-col overflow-y-auto py-1">
		{#each commands as command (command.name)}
			<AgentInputSlashCommandRow
				{command}
				{tokenType}
				showPreviewButton={showPreviewButton && tokenType === "skill"}
				onSelect={() => onSelect?.(command)}
				onPreview={() => onPreview?.(command)}
			/>
		{/each}
	</div>
</div>
