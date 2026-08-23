<script lang="ts">
	import { createPierreReviewDiffAttachment, pierreReviewDiffKey } from "./pierre-review-diff-attachment.js"
	import {
		hunkButtonsVisible,
		hunkIsVisible,
		selectedReviewFile,
		type ReviewModalViewModel,
	} from "./review-modal-state.js"

	let {
		model,
		onClose,
		onSelectFile,
		onAcceptHunk,
		onRejectHunk,
	}: {
		model: ReviewModalViewModel
		onClose: () => void
		onSelectFile: (path: string) => void
		onAcceptHunk: (path: string, hunkIndex: number) => void
		onRejectHunk: (path: string, hunkIndex: number) => void
	} = $props()

	const selectedFile = $derived(selectedReviewFile(model))
	let pierreAttachCache: {
		readonly key: string
		readonly attach: ReturnType<typeof createPierreReviewDiffAttachment>
	} | null = null
	const pierreAttach = $derived.by(() => {
		if (selectedFile === null) {
			return () => undefined
		}
		const input = {
			oldContent: selectedFile.oldContent,
			newContent: selectedFile.newContent,
			fileName: selectedFile.fileName,
		}
		const key = pierreReviewDiffKey(input)
		if (pierreAttachCache !== null && pierreAttachCache.key === key) {
			return pierreAttachCache.attach
		}
		const attach = createPierreReviewDiffAttachment(() => input)
		pierreAttachCache = { key, attach }
		return attach
	})
</script>

<div
	data-testid="git-review-modal"
	role="dialog"
	aria-label={model.title}
	class="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40"
>
	<section class="flex h-full w-[min(960px,100%)] flex-col gap-3 bg-background p-4 text-foreground shadow-lg">
		<header class="flex items-center justify-between gap-3">
			<h2 class="text-sm font-medium">{model.title}</h2>
			<button
				type="button"
				data-testid="git-review-close"
				class="rounded-md px-2 py-1 text-xs hover:bg-accent/40"
				onclick={() => onClose()}
			>
				{model.closeLabel}
			</button>
		</header>

		<section class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
			<div class="flex min-h-0 flex-1 gap-3">
				<aside class="flex w-[220px] shrink-0 flex-col gap-3 overflow-auto">
					<section>
						<h3 class="text-xs font-medium text-muted-foreground">{model.statusHeading}</h3>
						{#if model.status === null}
							<p data-testid="git-status-unavailable" class="text-xs text-muted-foreground">
								{model.statusUnavailableLabel}
							</p>
						{:else}
							<ul data-testid="git-status-list" class="flex flex-col gap-0.5">
								{#each model.status as row (row.path)}
									<li>
										<button
											type="button"
											data-testid="git-status-file"
											data-path={row.path}
											class="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent/40"
											onclick={() => onSelectFile(row.path)}
										>
											<span class="truncate">{row.path}</span>
											<span class="shrink-0 text-[10px] text-muted-foreground">{row.status}</span>
										</button>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				</aside>

				<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
					{#if selectedFile === null}
						<p data-testid="git-review-empty" class="text-xs text-muted-foreground">{model.emptyFilesLabel}</p>
					{:else}
						<div
							data-testid="git-review-diff"
							data-path={selectedFile.path}
							class="min-h-[200px] min-w-0 flex-1 overflow-auto rounded-md border border-border"
							{@attach pierreAttach}
						></div>
						<ul data-testid="git-hunk-list" class="flex flex-col gap-1">
							{#each selectedFile.hunks as hunk (hunk.index)}
								{#if hunkIsVisible(hunk)}
									<li
										data-testid={`git-hunk-${hunk.index}`}
										data-hunk-action={hunk.action ?? "pending"}
										class="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
									>
										<span>Hunk {hunk.index + 1}</span>
										{#if hunkButtonsVisible(hunk)}
											<button
												type="button"
												data-testid={`git-hunk-accept-${hunk.index}`}
												class="rounded-md bg-accent/30 px-2 py-0.5"
												onclick={() => onAcceptHunk(selectedFile.path, hunk.index)}
											>
												{model.acceptLabel}
											</button>
											<button
												type="button"
												data-testid={`git-hunk-reject-${hunk.index}`}
												class="rounded-md bg-accent/30 px-2 py-0.5"
												onclick={() => onRejectHunk(selectedFile.path, hunk.index)}
											>
												{model.rejectLabel}
											</button>
										{/if}
									</li>
								{/if}
							{/each}
						</ul>
						<section>
							<h3 class="text-xs font-medium text-muted-foreground">{model.blameHeading}</h3>
							<ul data-testid="git-blame-list" class="flex max-h-40 flex-col gap-0.5 overflow-auto">
								{#each selectedFile.blame as row (row.line)}
									<li data-testid="git-blame-line" data-line={row.line} class="text-[11px] text-muted-foreground">
										{row.line} {row.author} {row.summary}
									</li>
								{/each}
							</ul>
						</section>
					{/if}
				</div>
			</div>
		</section>
	</section>
</div>
