<script lang="ts">
import { DiffPill, ProjectLetterBadge } from "@acepe/ui";
import { ArrowDown } from "phosphor-svelte";
import { ArrowUp } from "phosphor-svelte";
import { GitBranch } from "phosphor-svelte";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import type { ProjectCardData } from "./project-card-data.js";

interface Props {
	data: ProjectCardData;
	index: number;
	modifierSymbol?: string;
	isMissing?: boolean;
	onSelect: () => void;
}

let {
	data,
	index,
	modifierSymbol = "⌘",
	isMissing = false,
	onSelect,
}: Props = $props();

const color = $derived(data.project.color ?? "#6B7280");
const shortcutKey = $derived(index + 1);

const totalInsertions = $derived(
	data.gitStatus?.reduce((sum, file) => sum + file.insertions, 0) ?? 0
);
const totalDeletions = $derived(
	data.gitStatus?.reduce((sum, file) => sum + file.deletions, 0) ?? 0
);
const changedFileCount = $derived(data.gitStatus?.length ?? 0);

function handleCardClick() {
	if (isMissing) return;
	onSelect();
}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if isMissing}
	<div
		class="flex flex-col overflow-hidden rounded-lg border border-dashed border-destructive/30 bg-destructive/5 cursor-not-allowed opacity-60"
		title="Folder not found: {data.project.path}"
	>
		<div class="flex items-center gap-2 px-2.5 h-8">
			<span class="h-2 w-2 rounded-full shrink-0 bg-destructive/40"></span>
			<span class="text-[11px] font-semibold text-muted-foreground truncate flex-1 line-through">
				{data.project.name}
			</span>
			<span class="text-[10px] text-destructive/70 shrink-0">Missing</span>
		</div>
	</div>
{:else}
	<div
		class="flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card/80 transition-all cursor-pointer hover:border-border hover:bg-card hover:shadow-sm"
		onclick={handleCardClick}
	>
		<div class="flex items-center h-8 shrink-0">
			<div class="inline-flex items-center justify-center h-8 w-8 shrink-0">
				<ProjectLetterBadge
					name={data.project.name}
					{color}
					iconSrc={data.project.iconPath ?? null}
					size={18}
				/>
			</div>

			<span class="text-[11px] font-semibold font-mono text-foreground truncate flex-1 min-w-0">
				{data.project.name}
			</span>

			{#if shortcutKey <= 9}
				<div class="shrink-0 pr-2">
					<KbdGroup class="inline-flex">
						<Kbd class="text-[9px] px-1 py-0.5 min-w-0">{modifierSymbol}</Kbd>
						<Kbd class="text-[9px] px-1 py-0.5 min-w-0">{shortcutKey}</Kbd>
					</KbdGroup>
				</div>
			{/if}
		</div>

		{#if data.branch || changedFileCount > 0}
			<div class="flex items-center h-6 px-2.5 gap-2 border-t border-border/30">
				{#if data.branch}
					<div class="flex items-center gap-0.5 min-w-0">
						<GitBranch class="size-2.5 shrink-0 text-muted-foreground/40" weight="fill" />
						<span class="text-[10px] font-mono text-muted-foreground/50 truncate">
							{data.branch}
						</span>
					</div>
				{/if}

				{#if data.ahead && data.ahead > 0}
					<div class="flex items-center gap-0.5 shrink-0" title="{data.ahead} ahead of remote">
						<ArrowUp class="size-2 text-success" weight="bold" />
						<span class="text-[10px] font-mono text-success">{data.ahead}</span>
					</div>
				{/if}
				{#if data.behind && data.behind > 0}
					<div class="flex items-center gap-0.5 shrink-0" title="{data.behind} behind remote">
						<ArrowDown class="size-2 text-warning" weight="bold" />
						<span class="text-[10px] font-mono text-warning">{data.behind}</span>
					</div>
				{/if}

				<div class="flex-1"></div>

				{#if totalInsertions > 0 || totalDeletions > 0}
					<DiffPill insertions={totalInsertions} deletions={totalDeletions} variant="plain" class="text-[10px]" />
				{/if}
				{#if changedFileCount > 0}
					<span class="text-[10px] text-muted-foreground/40 shrink-0">
						{changedFileCount} file{changedFileCount === 1 ? "" : "s"}
					</span>
				{/if}
			</div>
		{/if}
	</div>
{/if}
