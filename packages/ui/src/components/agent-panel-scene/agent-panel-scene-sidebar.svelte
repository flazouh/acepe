<script lang="ts">
	import type {
		AgentPanelActionCallbacks,
		AgentPanelActionDescriptor,
		AgentPanelSidebarModel,
	} from "../agent-panel/types.js";

	import { Button } from "../button/index.js";

	interface Props {
		sidebars: AgentPanelSidebarModel;
		actionCallbacks?: AgentPanelActionCallbacks;
	}

	let { sidebars, actionCallbacks = {} }: Props = $props();

	function actionDisabled(action: AgentPanelActionDescriptor): boolean {
		return action.state === "disabled" || action.state === "busy";
	}

	function runAction(action: AgentPanelActionDescriptor): void {
		const callback = actionCallbacks[action.id];
		callback?.();
	}

	function runActionById(actionId: AgentPanelActionDescriptor["id"] | null | undefined): void {
		if (!actionId) {
			return;
		}

		const callback = actionCallbacks[actionId];
		callback?.();
	}
</script>

{#if sidebars.plan || sidebars.attachedFiles || sidebars.browser}
	<aside class="flex w-72 shrink-0 flex-col border-l border-border/50 bg-background/80">
		{#if sidebars.plan}
			<div class="border-b border-border/50 p-3">
				<h3 class="text-sm font-medium text-foreground">{sidebars.plan.title}</h3>
				<div class="mt-3 space-y-2">
					{#each sidebars.plan.items as item (item.id)}
						<div class="rounded-lg border border-border/50 bg-accent/30 px-3 py-2">
							<div class="text-sm text-foreground">{item.label}</div>
							{#if item.description}
								<p class="mt-1 text-[11px] text-muted-foreground">{item.description}</p>
							{/if}
						</div>
					{/each}
				</div>
				<div class="mt-3 flex flex-wrap gap-1">
					{#each sidebars.plan.actions as action (action.id)}
						<Button
							variant="headerAction"
							size="headerAction"
							disabled={actionDisabled(action)}
							onclick={() => runAction(action)}
						>
							{action.label ?? action.id}
						</Button>
					{/each}
				</div>
			</div>
		{/if}

		{#if sidebars.attachedFiles}
			<div class="border-b border-border/50 p-3">
				<h3 class="text-sm font-medium text-foreground">Attached files</h3>
				<div class="mt-3 space-y-2">
					{#each sidebars.attachedFiles.tabs as tab (tab.id)}
						<div class="flex items-start gap-2 rounded-lg border border-border/50 px-3 py-2 {tab.isActive ? 'bg-accent/40' : 'bg-background/60'}">
							<button
								type="button"
								class="min-w-0 flex-1 text-left"
								disabled={!tab.selectActionId}
								onclick={() => runActionById(tab.selectActionId)}
							>
								<div class="truncate text-sm text-foreground">{tab.title}</div>
								{#if tab.path}
									<p class="mt-1 truncate text-[11px] text-muted-foreground">{tab.path}</p>
								{/if}
								{#if tab.contentPreview}
									<pre class="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{tab.contentPreview}</pre>
								{/if}
							</button>
							{#if tab.closeActionId}
								<Button
									variant="headerAction"
									size="headerAction"
									onclick={() => runActionById(tab.closeActionId)}
								>
									Close
								</Button>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if sidebars.browser}
			<div class="p-3">
				<h3 class="text-sm font-medium text-foreground">{sidebars.browser.title ?? "Browser"}</h3>
				<p class="mt-2 truncate text-[11px] text-muted-foreground">{sidebars.browser.url}</p>
				<p class="mt-2 text-[11px] text-muted-foreground">
					Embedded browser content stays desktop-owned; the shared scene shows browser metadata and
					actions only.
				</p>
				<div class="mt-3 flex flex-wrap gap-1">
					{#each sidebars.browser.actions as action (action.id)}
						<Button
							variant="headerAction"
							size="headerAction"
							disabled={actionDisabled(action)}
							onclick={() => runAction(action)}
						>
							{action.label ?? action.id}
						</Button>
					{/each}
				</div>
			</div>
		{/if}
	</aside>
{/if}
