<script lang="ts">
	import type { Snippet } from "svelte";
	import X from "phosphor-svelte/lib/X";
	import { EmbeddedIconButton, EmbeddedPanelHeader, HeaderActionCell } from "../panel-header/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import { GitHubBadge } from "../github-badge/index.js";
	import { InlineArtefactBadge } from "../inline-artefact-badge/index.js";
	import { DiffPill } from "../diff-pill/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { GitBranchBadge } from "../git-panel/index.js";
	import { PillButton } from "../pill-button/index.js";

	interface Props {
		onClose: () => void;
		/** Optional snippet to render additional showcase sections from the consuming app. */
		extraSections?: Snippet;
	}

	let { onClose, extraSections }: Props = $props();
</script>

<div class="flex h-full flex-col bg-background">
	<!-- Top bar -->
	<EmbeddedPanelHeader>
		<div class="flex flex-1 items-center gap-2 px-2.5">
			<span class="text-[11px] font-semibold font-mono uppercase tracking-wider text-muted-foreground">
				Design System
			</span>
		</div>
		<HeaderActionCell withDivider={false}>
			<EmbeddedIconButton title="Close" ariaLabel="Close" onclick={onClose}>
				<X class="size-4" />
			</EmbeddedIconButton>
		</HeaderActionCell>
	</EmbeddedPanelHeader>

	<!-- Scrollable content -->
	<div class="flex-1 overflow-y-auto p-6">
		<div class="mx-auto max-w-[640px] space-y-10">
			<!-- Section: Embedded Buttons -->
			<section>
				<h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Buttons</h2>
				<p class="mb-4 text-[11px] text-muted-foreground/70">
					Embedded-style buttons used in permission cards and panel headers.
				</p>

				<div class="space-y-4">
					<!-- Permission-style action buttons -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">Permission Action Buttons</h3>
						<div class="flex items-center gap-1">
							<button type="button" class="permission-btn">
								<span class="size-3.5 rounded-full" style="background: var(--destructive)"></span>
								<span>Deny</span>
							</button>
							<button type="button" class="permission-btn">
								<span class="size-3.5 rounded-full" style="background: var(--success)"></span>
								<span>Allow</span>
							</button>
							<button type="button" class="permission-btn">
								<span class="size-3.5 rounded-full" style="background: #9858FF"></span>
								<span>Always Allow</span>
							</button>
						</div>
					</div>

					<!-- Embedded icon buttons -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">Embedded Icon Buttons</h3>
						<div class="flex items-center gap-0.5">
							<EmbeddedIconButton title="Default" ariaLabel="Default">
								<X class="size-4" />
							</EmbeddedIconButton>
							<EmbeddedIconButton title="Active" ariaLabel="Active" active={true}>
								<X class="size-4" />
							</EmbeddedIconButton>
							<EmbeddedIconButton title="Disabled" ariaLabel="Disabled" disabled={true}>
								<X class="size-4" />
							</EmbeddedIconButton>
						</div>
					</div>
				</div>
			</section>

			<!-- Section: Permission Card -->
			<section>
				<h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Permission Card</h2>
				<p class="mb-4 text-[11px] text-muted-foreground/70">
					Compact card shown above the composer for tool permission requests. Uses embedded header styling, segmented progress, and muted background.
				</p>

				<div class="space-y-4">
					<!-- Example: with command -->
					<div class="mx-auto max-w-[460px]">
						<div class="permission-card-demo">
							<div class="flex h-7 items-center justify-between gap-2 border-b border-border/50 px-2.5">
								<div class="flex items-center gap-1.5">
									<span class="size-3 rounded-sm bg-primary"></span>
									<span class="text-[11px] font-medium text-muted-foreground">Execute</span>
									<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">src/main.ts</span>
								</div>
								<div class="flex items-center gap-[2px]">
									<div class="h-1.5 w-[5px] rounded-full" style="background: #f9c396"></div>
									<div class="h-1.5 w-[5px] rounded-full" style="background: #f9c396"></div>
									<div class="h-1.5 w-[5px] rounded-full" style="background: color-mix(in oklab, var(--foreground) 10%, transparent); opacity: 0.55"></div>
								</div>
							</div>
							<div class="border-b border-border/50 px-2.5 py-1.5">
								<code class="block font-mono text-[11px] text-foreground/70">$ bun test src/lib/utils.test.ts</code>
							</div>
							<div class="flex items-center justify-end px-2 py-1">
								<div class="flex items-center gap-1">
									<button type="button" class="permission-btn">
										<span class="size-3.5 rounded-full" style="background: var(--destructive)"></span>
										<span>Deny</span>
									</button>
									<button type="button" class="permission-btn">
										<span class="size-3.5 rounded-full" style="background: var(--success)"></span>
										<span>Allow</span>
									</button>
									<button type="button" class="permission-btn">
										<span class="size-3.5 rounded-full" style="background: #9858FF"></span>
										<span>Always Allow</span>
									</button>
								</div>
							</div>
						</div>
					</div>

					<!-- Example: file edit (no command) -->
					<div class="mx-auto max-w-[460px]">
						<div class="permission-card-demo">
							<div class="flex h-7 items-center justify-between gap-2 border-b border-border/50 px-2.5">
								<div class="flex items-center gap-1.5">
									<span class="size-3 rounded-sm bg-primary"></span>
									<span class="text-[11px] font-medium text-muted-foreground">Write</span>
									<span class="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">packages/ui/src/index.ts</span>
								</div>
								<div class="flex items-center gap-[2px]">
									<div class="h-1.5 w-[5px] rounded-full" style="background: #f9c396"></div>
									<div class="h-1.5 w-[5px] rounded-full" style="background: color-mix(in oklab, var(--foreground) 10%, transparent); opacity: 0.55"></div>
								</div>
							</div>
							<div class="flex items-center justify-end px-2 py-1">
								<div class="flex items-center gap-1">
									<button type="button" class="permission-btn">
										<span class="size-3.5 rounded-full" style="background: var(--destructive)"></span>
										<span>Deny</span>
									</button>
									<button type="button" class="permission-btn">
										<span class="size-3.5 rounded-full" style="background: var(--success)"></span>
										<span>Allow</span>
									</button>
								</div>
							</div>
						</div>
					</div>
				</div>
			</section>

			<!-- Section: Progress Indicators -->
			<section>
				<h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Progress Indicators</h2>
				<p class="mb-4 text-[11px] text-muted-foreground/70">
					Segmented progress bars used for download progress and permission counts.
				</p>

				<div class="rounded-md border border-border/50 p-4 space-y-4">
					<div>
						<h3 class="mb-2 text-[11px] font-medium text-foreground/60">Inline (permission tally)</h3>
						<div class="flex items-center gap-[2px]">
							{#each Array(5) as _, i}
								<div
									class="h-1.5 w-[5px] rounded-full"
									style="background: {i < 3 ? '#f9c396' : 'color-mix(in oklab, var(--foreground) 10%, transparent)'}; opacity: {i < 3 ? '1' : '0.55'}"
								></div>
							{/each}
						</div>
					</div>

					<div>
						<h3 class="mb-2 text-[11px] font-medium text-foreground/60">Compact (download bar)</h3>
						<div class="flex items-end gap-[1.5px]">
							{#each Array(16) as _, i}
								<div
									class="w-[2px] rounded-full"
									style="height: {i < 10 ? '7px' : '5px'}; background: {i < 10 ? '#f9c396' : 'color-mix(in oklab, var(--foreground) 10%, transparent)'}; opacity: {i < 10 ? '1' : '0.55'}"
								></div>
							{/each}
						</div>
					</div>
				</div>
			</section>

			<!-- Section: Embedded Panel Header -->
			<section>
				<h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Panel Header</h2>
				<p class="mb-4 text-[11px] text-muted-foreground/70">
					Embedded panel header with h-7 height, border-b, and action cells.
				</p>

				<div class="rounded-md border border-border/50 overflow-hidden">
					<EmbeddedPanelHeader>
						<div class="flex flex-1 items-center gap-2 px-2.5">
							<span class="size-3 rounded-sm bg-primary"></span>
							<span class="text-[11px] font-semibold font-mono text-foreground/80">Example Header</span>
						</div>
						<HeaderActionCell withDivider={false}>
							<EmbeddedIconButton title="Action" ariaLabel="Action">
								<X class="size-4" />
							</EmbeddedIconButton>
						</HeaderActionCell>
					</EmbeddedPanelHeader>
					<div class="p-3 text-[11px] text-muted-foreground">
						Panel content area
					</div>
				</div>
			</section>

			<!-- Section: Badges & Chips -->
			<section>
				<h2 class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Badges &amp; Chips</h2>
				<p class="mb-4 text-[11px] text-muted-foreground/70">
					Inline indicators for files, git references, projects, and input artefacts.
				</p>

				<div class="space-y-4">
					<!-- File Path Badges -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">File Path Badge</h3>
						<div class="flex flex-wrap items-center gap-2">
							<FilePathBadge filePath="src/lib/utils.ts" interactive={false} />
							<FilePathBadge filePath="packages/ui/src/index.ts" linesAdded={12} linesRemoved={3} interactive={false} />
							<FilePathBadge filePath="README.md" interactive={false} size="sm" />
							<FilePathBadge filePath="src/app.svelte" selected={true} interactive={false} />
						</div>
					</div>

					<!-- GitHub Badges -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">GitHub Badge</h3>
						<div class="flex flex-wrap items-center gap-2">
							<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 42 }} prState="open" />
							<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 38 }} prState="merged" insertions={84} deletions={12} />
							<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 15 }} prState="closed" />
							<GitHubBadge ref={{ type: "commit", sha: "a1b2c3d" }} />
							<GitHubBadge ref={{ type: "commit", sha: "e4f5a6b" }} insertions={7} deletions={2} />
							<GitHubBadge ref={{ type: "pr", owner: "flazouh", repo: "acepe", number: 99 }} loading={true} />
						</div>
					</div>

					<!-- Git Branch Badge -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">Git Branch Badge</h3>
						<div class="flex flex-wrap items-center gap-2">
							<GitBranchBadge branch="main" />
							<GitBranchBadge branch="feat/design-system-badges" />
							<GitBranchBadge branch="fix/very-long-branch-name-that-should-truncate" />
						</div>
					</div>

					<!-- Project Letter Badge -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">Project Letter Badge</h3>
						<div class="flex flex-wrap items-center gap-3">
							<div class="flex items-center gap-1.5">
								<ProjectLetterBadge name="Acepe" color="#3178c6" />
								<span class="text-[11px] text-muted-foreground">Acepe</span>
							</div>
							<div class="flex items-center gap-1.5">
								<ProjectLetterBadge name="Desktop" color="#ff3e00" />
								<span class="text-[11px] text-muted-foreground">Desktop</span>
							</div>
							<div class="flex items-center gap-1.5">
								<ProjectLetterBadge name="Website" color="#9858FF" size={16} />
								<span class="text-[11px] text-muted-foreground">sm</span>
							</div>
							<div class="flex items-center gap-1.5">
								<ProjectLetterBadge name="UI" color="#f9c396" size={28} />
								<span class="text-[11px] text-muted-foreground">lg</span>
							</div>
						</div>
					</div>

					<!-- Diff Pill -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">Diff Pill</h3>
						<div class="flex flex-wrap items-center gap-3">
							<div class="flex items-center gap-1.5">
								<DiffPill insertions={42} deletions={8} />
								<span class="text-[10px] text-muted-foreground">pill</span>
							</div>
							<div class="flex items-center gap-1.5">
								<DiffPill insertions={42} deletions={8} variant="plain" />
								<span class="text-[10px] text-muted-foreground">plain</span>
							</div>
							<div class="flex items-center gap-1.5">
								<DiffPill insertions={7} deletions={0} />
								<span class="text-[10px] text-muted-foreground">add only</span>
							</div>
							<div class="flex items-center gap-1.5">
								<DiffPill insertions={0} deletions={15} />
								<span class="text-[10px] text-muted-foreground">remove only</span>
							</div>
						</div>
					</div>

					<!-- Inline Artefact Badges -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">Inline Artefact Badge</h3>
						<div class="flex flex-wrap items-center gap-2">
							<InlineArtefactBadge tokenType="command" label="/plan" value="/plan" />
							<InlineArtefactBadge tokenType="skill" label="ce:work" value="ce:work" />
							<InlineArtefactBadge tokenType="file" label="utils.ts" value="src/lib/utils.ts" />
							<InlineArtefactBadge tokenType="image" label="screenshot.png" value="screenshot.png" />
							<InlineArtefactBadge tokenType="text" label="Selection" value="selected text" charCount={128} />
							<InlineArtefactBadge tokenType="text_ref" label="Clipboard" value="pasted text" charCount={64} />
						</div>
					</div>

					<!-- Pill Buttons -->
					<div class="rounded-md border border-border/50 p-4">
						<h3 class="mb-3 text-[11px] font-medium text-foreground/60">Pill Button</h3>
						<div class="flex flex-wrap items-center gap-2">
							<PillButton variant="primary" size="sm">Primary</PillButton>
							<PillButton variant="outline" size="sm">Outline</PillButton>
							<PillButton variant="ghost" size="sm">Ghost</PillButton>
							<PillButton variant="soft" size="sm">Soft</PillButton>
							<PillButton variant="invert" size="sm">Invert</PillButton>
							<PillButton variant="primary" size="xs">XS</PillButton>
							<PillButton variant="primary" disabled={true} size="sm">Disabled</PillButton>
						</div>
					</div>
				</div>
			</section>

			{#if extraSections}
				{@render extraSections()}
			{/if}
		</div>
	</div>
</div>

<style>
	.permission-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		font: inherit;
		font-size: 0.6875rem;
		color: var(--muted-foreground);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
	}

	.permission-btn:hover {
		background: color-mix(in srgb, var(--accent) 50%, transparent);
		color: var(--foreground);
		border-color: var(--border);
	}

	.permission-card-demo {
		overflow: hidden;
		border-radius: 6px;
		border: 1px solid var(--border);
		background: color-mix(in srgb, var(--card) 85%, var(--accent) 15%);
	}
</style>
