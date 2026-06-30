<script lang="ts">
import { LoadingIcon } from "@acepe/ui";
import type { PrChecksItem } from "@acepe/ui";
import { CheckCircle, GithubLogo, MinusCircle, Wrench, XCircle } from "phosphor-svelte";
import { openUrl } from "@tauri-apps/plugin-opener";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import type { CiJobDetails, CiJobStep } from "$lib/utils/tauri-client/git.js";
import { Button } from "@acepe/ui/button";

interface Props {
	open: boolean;
	check: PrChecksItem;
	job: CiJobDetails | null;
	isLoading: boolean;
	projectPath: string;
	onClose: () => void;
	onFix: (check: PrChecksItem) => void;
}

let { open, check, job, isLoading, onClose, onFix }: Props = $props();

type StepBucket = "failure" | "in_progress" | "neutral" | "success";

function bucketOfStep(step: CiJobStep): StepBucket {
	if (step.status !== "completed") return "in_progress";
	switch (step.conclusion) {
		case "success":
			return "success";
		case "failure":
		case "timed_out":
		case "startup_failure":
			return "failure";
		default:
			return "neutral";
	}
}

const firstFailedStep = $derived(job?.steps.find((s) => bucketOfStep(s) === "failure") ?? null);
let selectedStep = $state<CiJobStep | null>(null);
const activeStep = $derived(selectedStep ?? firstFailedStep ?? job?.steps[0] ?? null);

function openOnGitHub(): void {
	if (check.detailsUrl?.startsWith("https://github.com/")) {
		void openUrl(check.detailsUrl).catch(() => {});
	}
}
</script>

<DialogFrame
	{open}
	title={check.name}
	closeLabel="Close CI job details"
	contentOverflow="hidden"
	onOpenChange={(nextOpen) => {
		if (!nextOpen) {
			onClose();
		}
	}}
>
	{#snippet topRight()}
		{#if job}
			<span class="text-xs text-muted-foreground capitalize">{job.conclusion ?? job.status}</span>
		{/if}
	{/snippet}

	{#snippet footer()}
		<Button
			variant="default"
			size="sm"
			class="mr-auto gap-1.5"
			onclick={() => onFix(check)}
		>
			<Wrench size={12} weight="fill" />
			Fix with agent
		</Button>
		<Button
			variant="ghost"
			size="sm"
			class="gap-1.5 text-muted-foreground"
			onclick={openOnGitHub}
		>
			<GithubLogo size={12} weight="fill" />
			View on GitHub
		</Button>
	{/snippet}

	<div class="flex min-h-0 flex-1">
		{#if isLoading}
			<div class="flex flex-1 items-center justify-center">
				<LoadingIcon class="animate-spin text-muted-foreground" size={20} />
			</div>
		{:else if job}
			<!-- Step list -->
			<div class="flex w-52 shrink-0 flex-col overflow-y-auto border-r border-border py-2">
				{#each job.steps as step (step.number)}
					{@const bucket = bucketOfStep(step)}
					{@const isActive = activeStep?.number === step.number}
					<button
						type="button"
						class="flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors {isActive
							? 'bg-accent text-foreground'
							: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}"
						onclick={() => {
							selectedStep = step;
						}}
					>
						<span class="shrink-0">
							{#if bucket === "in_progress"}
								<LoadingIcon class="animate-spin" size={10} />
							{:else if bucket === "failure"}
								<XCircle size={10} weight="fill" class="text-destructive" />
							{:else if bucket === "neutral"}
								<MinusCircle size={10} weight="fill" class="text-amber-400" />
							{:else}
								<CheckCircle size={10} weight="fill" class="text-emerald-500" />
							{/if}
						</span>
						<span class="truncate">{step.name}</span>
					</button>
				{/each}
			</div>

			<!-- Log panel -->
			<div class="flex min-w-0 flex-1 flex-col overflow-hidden">
				{#if activeStep}
					<div class="border-b border-border px-4 py-2">
						<span class="text-xs font-medium text-foreground">{activeStep.name}</span>
					</div>
					<div class="min-h-0 flex-1 overflow-y-auto p-4">
						{#if activeStep.log}
							<pre class="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/80">{activeStep.log}</pre>
						{:else}
							<p class="text-xs text-muted-foreground">No log output for this step.</p>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-1 items-center justify-center">
				<p class="text-sm text-muted-foreground">Failed to load job details.</p>
			</div>
		{/if}
	</div>
</DialogFrame>
