<script lang="ts">
import { RoundedIcon, roundedIconLibrary } from "@acepe/ui/icons";
</script>

<svelte:head>
	<title>Icons | Acepe Design System</title>
</svelte:head>

<main
	class="h-screen overflow-y-auto bg-background px-6 py-6 text-foreground sm:px-8"
	data-testid="design-system-icons-page"
>
	<h1 class="sr-only">Acepe rounded icons</h1>

	<div
		class="mx-auto grid max-w-[92rem] grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-2"
		data-testid="design-system-icon-grid"
	>
		{#each roundedIconLibrary as icon (icon.name)}
			<div
				class="flex aspect-square items-center justify-center rounded-md border border-border/50 bg-card/45 text-muted-foreground transition-colors hover:border-border hover:bg-card hover:text-foreground"
				title={icon.name}
			>
				<RoundedIcon name={icon.name} class="size-5" aria-label={icon.label} />
			</div>
		{/each}
	</div>
</main>
