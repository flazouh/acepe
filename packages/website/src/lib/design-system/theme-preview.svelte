<script lang="ts">
import type { UiThemeFamily } from "@acepe/ui/themes";

interface Props {
	family: UiThemeFamily;
	appearance: "light" | "dark";
}

let { family, appearance }: Props = $props();
</script>

<div
	data-ui-theme={family.id}
	class="overflow-hidden rounded-lg border border-border/60 {appearance === 'dark' ? 'dark' : ''}"
>
	<div class="bg-background p-3">
		<div class="flex gap-2">
			<div class="w-16 shrink-0 rounded-md bg-sidebar p-2">
				<div class="mb-1.5 h-1.5 w-8 rounded-full bg-sidebar-foreground/50"></div>
				<div class="mb-1 h-1.5 w-10 rounded-full bg-sidebar-accent"></div>
				<div class="h-1.5 w-6 rounded-full bg-sidebar-accent"></div>
			</div>

			<div class="min-w-0 flex-1 rounded-md border border-border bg-card p-2.5">
				<p class="truncate text-[11px] font-medium text-card-foreground">Session title</p>
				<p class="mt-0.5 truncate text-[10px] text-muted-foreground">3 files changed</p>
				<div class="mt-2 flex items-center gap-1.5">
					<span
						class="rounded px-1.5 py-0.5 text-[9px] font-medium"
						style="background: var(--primary); color: var(--primary-foreground);"
					>
						Primary
					</span>
					<span
						class="rounded px-1.5 py-0.5 text-[9px]"
						style="background: var(--secondary); color: var(--secondary-foreground);"
					>
						Second
					</span>
					<span class="ml-auto flex gap-1">
						<span class="size-2 rounded-full" style="background: var(--success);"></span>
						<span class="size-2 rounded-full" style="background: var(--destructive);"></span>
						<span class="size-2 rounded-full" style="background: var(--ring);"></span>
					</span>
				</div>
				<div class="mt-2 flex gap-0.5">
					{#each [1, 2, 3, 4, 5] as n (n)}
						<span class="h-1.5 flex-1 rounded-full" style="background: var(--chart-{n});"></span>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>
