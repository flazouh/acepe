<script lang="ts">
import { PlanIcon } from "@acepe/ui/icons";
import {
	CloseAction,
	EmbeddedIconButton,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
} from "@acepe/ui/panel-header";
import { DownloadSimple } from "phosphor-svelte";
import * as Dialog from "@acepe/ui/dialog";
import { toastSuccess } from "$lib/components/ui/sonner/toast-bridge.js";
import type { SessionPlanResponse } from "../../services/claude-history.js";

import { useSessionContext } from "../hooks/use-session-context.js";
import CopyButton from "./messages/copy-button.svelte";
import MarkdownText from "./messages/markdown-text.svelte";

interface Props {
	plan: SessionPlanResponse;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectPath?: string;
}

let { plan, open, onOpenChange, projectPath: propProjectPath }: Props = $props();

const sessionContext = useSessionContext();
const projectPath = $derived(propProjectPath ?? sessionContext?.projectPath);

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

<Dialog.Root bind:open {onOpenChange}>
	<Dialog.Content
		showCloseButton={false}
		class="max-w-5xl w-[90vw] max-h-[85vh] flex flex-col gap-0 !p-0 overflow-hidden rounded-xl border border-border/40 bg-background"
	>
		<!-- Header -->
		<EmbeddedPanelHeader class="bg-muted/10 border-border/30">
			<HeaderTitleCell>
				<PlanIcon size="md" class="shrink-0 mr-1.5" />
				<span
					class="text-[11px] font-semibold font-mono text-foreground select-none truncate leading-none"
				>
					{plan.title}
				</span>
			</HeaderTitleCell>

			<HeaderActionCell withDivider={false}>
				<CopyButton text={plan.content} variant="embedded" stopPropagation={true} />
				<EmbeddedIconButton
					title={"Download"}
					ariaLabel={"Download"}
					onclick={downloadAsMarkdown}
				>
					<DownloadSimple size={14} weight="bold" />
				</EmbeddedIconButton>
			</HeaderActionCell>

			<HeaderActionCell>
				<CloseAction onClose={() => onOpenChange(false)} />
			</HeaderActionCell>
		</EmbeddedPanelHeader>

		<!-- Summary row -->
		{#if plan.summary}
			<div class="px-5 py-2 border-b border-border/20 bg-muted/10">
				<p class="text-[12px] text-muted-foreground leading-relaxed">{plan.summary}</p>
			</div>
		{/if}

		<!-- Content -->
		<div class="flex-1 overflow-y-auto">
			<div class="px-6 py-5">
				<MarkdownText text={plan.content} {projectPath} />
			</div>
		</div>

		<!-- Footer -->
		<div class="px-5 py-2 border-t border-border/20 bg-muted/10 shrink-0">
			<p class="text-[10px] font-mono text-muted-foreground/50">
				{plan.content.length.toLocaleString()} characters
			</p>
		</div>
	</Dialog.Content>
</Dialog.Root>
