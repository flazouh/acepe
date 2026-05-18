<script lang="ts">
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import { PlanSidebarLayout } from "@acepe/ui/plan-sidebar";
import { ArrowsOut } from "phosphor-svelte";
import { DownloadSimple } from "phosphor-svelte";
import { toast } from "svelte-sonner";
import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
import type { SessionPlanResponse } from "$lib/services/converted-session-types.js";

import CopyButton from "../messages/copy-button.svelte";
import MarkdownText from "../messages/markdown-text.svelte";

interface Props {
	plan: SessionPlanResponse;
	projectPath?: string;
	columnWidth?: number;
	onOpenFullscreen: () => void;
	onClose?: () => void;
}

let {
	plan,
	projectPath,
	columnWidth = 450,
	onOpenFullscreen,
	onClose,
}: Props = $props();

function handleDownloadMarkdown() {
	const blob = new Blob([plan.content], { type: "text/markdown" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${plan.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.md`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
	toast.success("Plan downloaded");
}
</script>

<div
	class="flex h-full min-h-0 shrink-0 flex-col border-l border-border"
	style="min-width: {columnWidth}px; width: {columnWidth}px; max-width: {columnWidth}px; flex-basis: {columnWidth}px;"
>
	<PlanSidebarLayout
		title={plan.title}
		slug={plan.slug}
		content={plan.content}
		{onClose}
	>
		{#snippet headerActions()}
			<CopyButton text={plan.content} variant="embedded" stopPropagation={true} />
			<EmbeddedIconButton
				title={"Download"}
				ariaLabel={"Download"}
				onclick={handleDownloadMarkdown}
			>
				<DownloadSimple size={14} weight="bold" />
			</EmbeddedIconButton>
			<EmbeddedIconButton
				title={"Open in fullscreen"}
				ariaLabel={"Open in fullscreen"}
				onclick={onOpenFullscreen}
			>
				<ArrowsOut size={14} weight="bold" />
			</EmbeddedIconButton>
		{/snippet}
		{#snippet contentRenderer()}
			<ScrollArea class="h-full min-h-0 flex-1">
				<div class="px-4 py-3">
					<MarkdownText text={plan.content} {projectPath} />
				</div>
			</ScrollArea>
		{/snippet}
	</PlanSidebarLayout>
</div>
