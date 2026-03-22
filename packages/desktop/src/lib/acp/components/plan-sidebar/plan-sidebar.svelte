<script lang="ts">
import { EmbeddedIconButton } from "@acepe/ui/panel-header";
import { PlanSidebarLayout } from "@acepe/ui/plan-sidebar";
import ArrowsOut from "phosphor-svelte/lib/ArrowsOut";
import DownloadSimple from "phosphor-svelte/lib/DownloadSimple";
import { toast } from "svelte-sonner";
import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
import * as m from "$lib/paraglide/messages.js";
import type { SessionPlanResponse } from "$lib/services/converted-session-types.js";

import { useSessionContext } from "../../hooks/use-session-context.js";
import { getSessionStore } from "../../store/session-store.svelte.js";
import CopyButton from "../messages/copy-button.svelte";
import MarkdownText from "../messages/markdown-text.svelte";

interface Props {
	plan: SessionPlanResponse;
	projectPath?: string;
	sessionId?: string;
	columnWidth?: number;
	onOpenFullscreen: () => void;
	onClose?: () => void;
}

let {
	plan,
	projectPath: propProjectPath,
	sessionId,
	columnWidth = 450,
	onOpenFullscreen,
	onClose,
}: Props = $props();

// Get projectPath from context or use prop (backward compatibility)
const sessionContext = useSessionContext();
const projectPath = $derived(propProjectPath ?? sessionContext?.projectPath);

let isBuilding = $state(false);

const sessionStore = getSessionStore();

async function handleBuildPlan() {
	if (!sessionId) {
		toast.error(m.plan_sidebar_no_active_session());
		return;
	}

	isBuilding = true;

	const message = m.plan_sidebar_build_message();

	await sessionStore.sendMessage(sessionId, message).match(
		() => {},
		(error) => {
			toast.error(m.plan_sidebar_send_message_error({ error: error.message }));
			isBuilding = false;
		}
	);
}

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
	toast.success(m.plan_downloaded());
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
		{isBuilding}
		onBuild={handleBuildPlan}
		{onClose}
		buildLabel={m.plan_sidebar_build()}
		buildingLabel={m.plan_sidebar_building()}
	>
		{#snippet headerActions()}
			<CopyButton text={plan.content} variant="embedded" stopPropagation={true} />
			<EmbeddedIconButton
				title={m.plan_download()}
				ariaLabel={m.plan_download()}
				onclick={handleDownloadMarkdown}
			>
				<DownloadSimple size={14} weight="bold" />
			</EmbeddedIconButton>
			<EmbeddedIconButton
				title={m.plan_sidebar_open_fullscreen()}
				ariaLabel={m.plan_sidebar_open_fullscreen()}
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
