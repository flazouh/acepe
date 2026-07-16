<script lang="ts">
	import Button from "./button.svelte";
	import { HugeiconsIcon } from "../icons/index.js";
	import {
		buttonSizeShowcaseColumnMinWidth,
		buttonSizeShowcaseOrder,
		buttonVariantShowcaseEntries,
		controlTokensShowcaseMeta,
		getButtonShowcaseDisplay,
	} from "./control-tokens-showcase-meta.js";

	export { controlTokensShowcaseMeta };
</script>

<div class="flex flex-col gap-3">
	<div class="overflow-hidden rounded-lg border border-border/40 bg-card">
		<div class="overflow-x-auto">
			<table class="w-max min-w-full border-collapse">
				<colgroup>
					<col class="min-w-[14rem]" />
					{#each buttonSizeShowcaseOrder as size (size)}
						<col style:min-width={buttonSizeShowcaseColumnMinWidth[size]} />
					{/each}
				</colgroup>
				<thead>
					<tr class="border-b border-border/30 bg-muted/20">
						<th
							scope="col"
							class="sticky left-0 z-20 border-r border-border/30 bg-muted/20 px-3 py-2 text-left align-bottom"
						>
							<span class="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
								Variant
							</span>
						</th>
						{#each buttonSizeShowcaseOrder as size (size)}
							<th
								scope="col"
								class="border-r border-border/20 px-2 py-2 text-left align-bottom last:border-r-0"
							>
								<p class="font-mono text-[9px] font-medium text-foreground">{size}</p>
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each buttonVariantShowcaseEntries as entry (entry.variant)}
						<tr class="border-b border-border/20 last:border-b-0">
							<th
								scope="row"
								class="sticky left-0 z-10 border-r border-border/30 bg-card px-3 py-2.5 text-left align-top"
							>
								<p class="font-mono text-[11px] font-medium text-foreground">{entry.variant}</p>
								<p class="mt-0.5 text-[10px] leading-snug text-muted-foreground">
									{entry.description}
								</p>
							</th>
							{#each buttonSizeShowcaseOrder as size (size)}
								{@const display = getButtonShowcaseDisplay(entry.variant, size)}
								<td
									class="border-r border-border/20 px-2 py-2.5 text-center align-middle last:border-r-0"
								>
									<div class="flex items-center justify-center">
										<Button variant={entry.variant} {size}>
											{#snippet children()}
												{#if display.kind === "icon"}
													<HugeiconsIcon name="settings" />
												{:else}
													<span class="truncate">{display.label}</span>
												{/if}
											{/snippet}
										</Button>
									</div>
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
