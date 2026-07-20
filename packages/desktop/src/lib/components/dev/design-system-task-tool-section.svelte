<script lang="ts">
import { AgentToolTask, AgentToolWebSearch } from "@acepe/ui";
import { AgentCopyButton } from "@acepe/ui/agent-panel";
import { NativeMarkdown } from "@acepe/ui/native-markdown";

import { Badge } from "$lib/components/ui/badge/index.js";
import SettingRow from "$lib/components/settings-page/setting-row.svelte";
import SettingsSection from "$lib/components/settings-page/settings-section.svelte";
import CopyButton from "$lib/acp/components/messages/copy-button.svelte";

import {
	featuredTaskToolSpecimen,
	taskToolSpecimens,
	type TaskToolSpecimen,
} from "./design-system-task-tool-specimens.js";

function specimenDescription(specimen: TaskToolSpecimen): string {
	const mode = specimen.compact ? "compact" : "default";
	const childCount = specimen.children.length;
	return `${specimen.caption} · ${mode} · ${childCount} ${childCount === 1 ? "child" : "children"}`;
}
</script>

<div class="w-full">
	<SettingsSection
		title="In context"
		description="Live AgentToolTask header as rendered in the agent panel while a subagent is running."
	>
		<div class="rounded-lg border border-border/40 bg-card p-3">
			<AgentToolTask
				description={featuredTaskToolSpecimen.taskDescription}
				status={featuredTaskToolSpecimen.status}
				children={featuredTaskToolSpecimen.children}
				iconBasePath="/svgs/icons"
				durationTiming={{
					startedAtMs: Date.now() - 4200,
					completedAtMs: null,
					status: featuredTaskToolSpecimen.status,
				}}
			/>
		</div>
	</SettingsSection>

	<SettingsSection
		title="Generic copy icons"
		description="Generic copy controls use the shared Hugeicons Copy icon."
	>
		<div class="grid gap-3 lg:grid-cols-2">
			<div class="rounded-lg border border-border/40 bg-card p-3">
				<p class="mb-2 text-sm text-muted-foreground">Message copy button</p>
				<AgentCopyButton text="Copyable design-system sample" />
			</div>
			<div class="rounded-lg border border-border/40 bg-card p-3">
				<p class="mb-2 text-sm text-muted-foreground">Desktop ACP copy button</p>
				<CopyButton text="Copyable desktop ACP sample" title="Copy ACP sample" />
			</div>
			<div class="rounded-lg border border-border/40 bg-card p-3 lg:col-span-2">
				<NativeMarkdown markdown={"```ts\nconst hugeiconsCopy = true;\n```"} />
			</div>
		</div>
	</SettingsSection>

	<SettingsSection
		title="Current tool labels"
		description="Each specimen renders the task title on the left and the latest child tool as a verb label plus context on the right."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{taskToolSpecimens.length} specimens
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each taskToolSpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={specimenDescription(specimen)}>
					<div class="rounded-lg border border-border/50 bg-input/30 p-2">
						<AgentToolTask
							description={specimen.taskDescription}
							status={specimen.status}
							children={specimen.children}
							showDoneIcon={specimen.showDoneIcon ?? false}
							compact={specimen.compact ?? false}
							prompt={specimen.prompt ?? null}
							resultText={specimen.resultText ?? null}
							iconBasePath="/svgs/icons"
							durationTiming={{
								startedAtMs: Date.now() - 6800,
								completedAtMs: specimen.status === "done" ? Date.now() - 1200 : null,
								status: specimen.status,
							}}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="Web search result links"
		description="Full web search result cards use the open-in-new-window icon for outbound links."
	>
		<div class="rounded-lg border border-border/40 bg-card p-3">
			<AgentToolWebSearch
				query="shared icon external navigation"
				status="done"
				summary="Search results used to verify external link affordances."
				links={[
					{
						title: "Acepe changelog",
						url: "https://acepe.dev/changelog",
						domain: "acepe.dev",
					},
					{
						title: "Acepe repository",
						url: "https://github.com/flazouh/acepe",
						domain: "github.com",
					},
				]}
			/>
		</div>
	</SettingsSection>

</div>
