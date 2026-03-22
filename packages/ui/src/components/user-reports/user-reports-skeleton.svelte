<div class="flex flex-col">
	{#each Array(5) as _}
		<div class="flex items-start gap-2.5 px-3 py-2.5 border-b border-border/20 animate-pulse">
			<div class="flex flex-col items-center gap-1 pt-0.5">
				<div class="h-5 w-5 rounded bg-accent/40"></div>
				<div class="h-3 w-4 rounded bg-accent/30"></div>
				<div class="h-5 w-5 rounded bg-accent/40"></div>
			</div>
			<div class="flex-1 flex flex-col gap-1.5">
				<div class="h-3.5 w-3/4 rounded bg-accent/40"></div>
				<div class="flex gap-2">
					<div class="h-4 w-12 rounded-full bg-accent/30"></div>
					<div class="h-4 w-10 rounded bg-accent/25"></div>
					<div class="h-4 w-8 rounded bg-accent/20"></div>
				</div>
			</div>
		</div>
	{/each}
</div>
