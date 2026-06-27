<script lang="ts">
import { PlanIcon } from "@acepe/ui/icons";
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import { DownloadSimple } from "phosphor-svelte";
import { toastSuccess } from "$lib/components/ui/sonner/toast-bridge.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import type { SessionPlanResponse } from "../../services/claude-history.js";

import CopyButton from "./messages/copy-button.svelte";
import MarkdownText from "./messages/markdown-text.svelte";

interface PlanDialogPlan {
	title: string;
	content: string;
	summary?: string | null;
}

interface Props {
	plan: PlanDialogPlan | SessionPlanResponse;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectPath?: string;
}

let { plan, open, onOpenChange, projectPath }: Props = $props();

function downloadAsMarkdown() {
	const blob = new Blob([plan.content], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${plan.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.md`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
	toastSuccess("Plan downloaded");
}
</script>

<DialogFrame
	{open}
	title={plan.title}
	closeLabel="Close plan"
	contentOverflow="hidden"
	{onOpenChange}
>
	{#snippet topLeft()}
		<PlanIcon size="md" class="shrink-0" />
		<span
			class="truncate text-[11px] font-semibold font-mono text-foreground select-none leading-none"
		>
			{plan.title}
		</span>
	{/snippet}

	{#snippet topRight()}
		<CopyButton text={plan.content} variant="embedded" stopPropagation={true} />
		<EmbeddedIconButton title={"Download"} ariaLabel={"Download"} onclick={downloadAsMarkdown}>
			<DownloadSimple size={14} weight="bold" />
		</EmbeddedIconButton>
	{/snippet}

	<div class="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border/40 bg-background">
		{#if plan.summary}
			<div class="border-b border-border/20 bg-muted/10 px-5 py-2">
				<p class="text-[12px] leading-relaxed text-muted-foreground">{plan.summary}</p>
			</div>
		{/if}

		<div class="flex-1 overflow-y-auto">
			<div class="px-6 py-5">
				<MarkdownText text={plan.content} {projectPath} />
			</div>
		</div>

		<div class="shrink-0 border-t border-border/20 bg-muted/10 px-5 py-2">
			<p class="font-mono text-[10px] text-muted-foreground/50">
				{plan.content.length.toLocaleString()} characters
			</p>
		</div>
	</div>
</DialogFrame>
