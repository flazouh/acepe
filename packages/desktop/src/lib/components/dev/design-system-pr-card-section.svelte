<script lang="ts">
	import {
		AgentPanelPrCard,
		BrowserNavActions,
		GitCommitHeader,
		GitPrHeader,
		KanbanScenePrFooter,
		PrChecksList,
		PrChecksSummary,
		type GitCommitData,
		type GitPrData,
	} from "@acepe/ui";

	import CiJobModal from "$lib/acp/components/pr-status-card/ci-job-modal.svelte";
	import GitHubBadge from "$lib/acp/components/github-badge.svelte";
	import { Badge } from "$lib/components/ui/badge/index.js";
	import SettingRow from "$lib/components/settings-page/setting-row.svelte";
	import SettingsSection from "$lib/components/settings-page/settings-section.svelte";

	import {
		featuredCiJobCheck,
		featuredCiJobDetails,
		featuredPrCardSpecimen,
		prCardComponentLinks,
		prCardSpecimens,
		prChecksSummarySpecimens,
		type PrCardComponentLink,
		type PrCardSpecimen,
		type PrChecksSummarySpecimen,
	} from "./design-system-pr-card-specimens.js";

	let ciModalOpen = $state(false);

	function layerBadgeVariant(layer: PrCardComponentLink["layer"]): "default" | "secondary" | "outline" {
		if (layer === "View") return "secondary";
		if (layer === "Controller") return "outline";
		return "default";
	}

	function checksSpecimenDescription(specimen: PrChecksSummarySpecimen): string {
		return specimen.caption;
	}

	function prCardSpecimenDescription(specimen: PrCardSpecimen): string {
		return specimen.caption;
	}

	const externalPrHeaderSpecimen: GitPrData = {
		number: 42,
		title: "Land Linear external navigation icons",
		author: "alex",
		state: "open",
		files: [],
		githubUrl: "https://github.com/flazouh/acepe/pull/42",
	};

	const externalCommitHeaderSpecimen: GitCommitData = {
		sha: "3773ee3670000000000000000000000000000000",
		shortSha: "3773ee3",
		message: "Land Linear external navigation icons",
		author: "alex",
		date: "2026-07-12",
		files: [],
		githubUrl: "https://github.com/flazouh/acepe/commit/3773ee367",
	};
</script>

<div class="w-full">
	<SettingsSection
		title="Component map"
		description="PR card UI is split across @acepe/ui views and desktop controllers."
	>
		<div class="overflow-hidden rounded-lg border border-border/40 bg-card">
			{#each prCardComponentLinks as link (link.id)}
				<div class="border-b border-border/30 px-3 py-2.5 last:border-b-0">
					<div class="flex flex-wrap items-center gap-2">
						<p class="text-sm font-medium text-foreground">{link.name}</p>
						<Badge variant={layerBadgeVariant(link.layer)} class="font-mono text-[10px]">
							{link.layer}
						</Badge>
					</div>
					<p class="mt-1 text-sm text-muted-foreground">{link.role}</p>
					<p class="mt-1 font-mono text-[11px] text-muted-foreground/70">{link.location}</p>
				</div>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="In context"
		description={featuredPrCardSpecimen.caption}
	>
		<div class="rounded-lg border border-border/40 bg-card p-3">
			<AgentPanelPrCard
				visible={true}
				model={featuredPrCardSpecimen.model}
				initiallyExpanded={featuredPrCardSpecimen.initiallyExpanded ?? false}
				initiallyExpandedChecks={featuredPrCardSpecimen.initiallyExpandedChecks ?? false}
			/>
		</div>
	</SettingsSection>

	<SettingsSection
		title="External navigation icons"
		description="GitHub and PR external-open controls use the open-in-new-window icon."
	>
		<div class="grid gap-3 lg:grid-cols-2">
			<div class="rounded-lg border border-border/50 bg-input/30 p-2">
				<GitPrHeader
					pr={externalPrHeaderSpecimen}
					onViewOnGitHub={() => {}}
				/>
			</div>
			<div class="rounded-lg border border-border/50 bg-input/30 p-2">
				<GitCommitHeader
					commit={externalCommitHeaderSpecimen}
					onViewOnGitHub={() => {}}
				/>
			</div>
			<div class="rounded-lg border border-border/50 bg-input/30 p-2 lg:col-span-2">
				<KanbanScenePrFooter
					prNumber={42}
					prState="OPEN"
					title="Land Linear external navigation icons"
					url="https://github.com/flazouh/acepe/pull/42"
					additions={12}
					deletions={3}
					isLoading={false}
					hasResolvedDetails={true}
					checks={[]}
					isChecksLoading={false}
					hasResolvedChecks={true}
					onOpen={() => {}}
					onOpenExternal={() => {}}
				/>
			</div>
			<div class="rounded-lg border border-border/50 bg-input/30 p-2 lg:col-span-2">
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">GitHub badge action</span>
					<GitHubBadge
						ref={{ type: "commit", owner: "flazouh", repo: "acepe", sha: "3773ee3" }}
						projectPath="/tmp/acepe-design-system"
					/>
				</div>
			</div>
			<div class="rounded-lg border border-border/50 bg-input/30 p-2 lg:col-span-2">
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">Browser header action</span>
					<BrowserNavActions
						showNavigation={false}
						showExternal={true}
						openExternalLabel="Open in browser"
						onOpenExternal={() => {}}
					/>
				</div>
			</div>
		</div>
	</SettingsSection>

	<SettingsSection
		title="CI summary labels"
		description="PrChecksList summary row uses labeled buckets. Expand a row to inspect individual checks."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{prChecksSummarySpecimens.length} specimens
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each prChecksSummarySpecimens as specimen (specimen.id)}
				<SettingRow
					stacked
					label={specimen.label}
					description={checksSpecimenDescription(specimen)}
				>
					<div class="rounded-lg border border-border/50 bg-input/30 px-3 py-2">
						<PrChecksList
							checks={specimen.checks}
							isLoading={specimen.isLoading ?? false}
							hasResolved={specimen.hasResolved ?? true}
							initiallyExpanded={specimen.initiallyExpanded ?? false}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="CI tone dot"
		description="PrChecksSummary renders the compact status dot used in kanban cards and session rows."
	>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each prChecksSummarySpecimens.filter((specimen) => specimen.id !== "loading" && specimen.id !== "waiting") as specimen (specimen.id)}
				<div class="flex items-center gap-2 rounded-lg border border-border/50 bg-input/30 px-3 py-2">
					<PrChecksSummary
						checks={specimen.checks}
						isLoading={specimen.isLoading ?? false}
						hasResolved={specimen.hasResolved ?? true}
						size="md"
					/>
					<span class="text-sm text-muted-foreground">{specimen.label}</span>
				</div>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="PR card states"
		description="AgentPanelPrCard specimens covering CI, streaming, and creation states."
	>
		{#snippet headerActions()}
			<Badge variant="secondary" class="font-mono text-[10px]">
				{prCardSpecimens.length} specimens
			</Badge>
		{/snippet}

		<div class="overflow-hidden rounded-lg border border-border/40 bg-card px-3">
			{#each prCardSpecimens as specimen (specimen.id)}
				<SettingRow stacked label={specimen.label} description={prCardSpecimenDescription(specimen)}>
					<div class="rounded-lg border border-border/50 bg-input/30 p-2">
						<AgentPanelPrCard
							visible={true}
							model={specimen.model}
							initiallyExpanded={specimen.initiallyExpanded ?? false}
							initiallyExpandedChecks={specimen.initiallyExpandedChecks ?? false}
						/>
					</div>
				</SettingRow>
			{/each}
		</div>
	</SettingsSection>

	<SettingsSection
		title="CI job modal"
		description="CiJobModal opens from a failed check row in the desktop PR card controller."
	>
		<div class="flex flex-col gap-3 rounded-lg border border-border/40 bg-card p-3">
			<p class="text-sm text-muted-foreground">
				Inspect step logs and launch “Fix with agent” from a failed workflow job.
			</p>
			<div>
				<button
					type="button"
					data-testid="open-ci-job-modal-specimen"
					class="rounded-md border border-border bg-input/40 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
					onclick={() => {
						ciModalOpen = true;
					}}
				>
					Open CiJobModal specimen
				</button>
			</div>
		</div>
	</SettingsSection>
</div>

<CiJobModal
	open={ciModalOpen}
	check={featuredCiJobCheck}
	job={featuredCiJobDetails}
	isLoading={false}
	projectPath="/Users/alex/Documents/acepe"
	onClose={() => {
		ciModalOpen = false;
	}}
	onFix={() => {
		ciModalOpen = false;
	}}
/>
