<script lang="ts">
	import { Button, HugeiconsIcon, Selector } from "@acepe/ui";
	import * as DropdownMenu from "@acepe/ui/dropdown-menu";
</script>

<section class="space-y-4" data-testid="design-system-skills-copy-section">
	<div class="space-y-1">
		<h3 class="text-sm font-semibold">Skills copy controls</h3>
		<p class="max-w-2xl text-xs text-muted-foreground">
			Linear Copy icon fixtures for Skills surfaces that require plugin-skill state in
			the real app.
		</p>
	</div>

	<div class="flex flex-wrap items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-4">
		<Button variant="outline" size="sm" class="h-7 text-xs">
			<HugeiconsIcon name="copy" class="h-3 w-3 mr-1" data-testid="skills-editor-copy-hugeicons-icon" />
			Copy to Claude Code
		</Button>

		<Button variant="outline" size="sm">
			<HugeiconsIcon
				name="copy"
				class="h-3.5 w-3.5"
				data-testid="skills-page-copy-hugeicons-icon"
			/>
			Copy to Library
		</Button>

		<Selector align="end" triggerSize="icon" showChevron={false} variant="ghost">
			{#snippet renderButton()}
				<HugeiconsIcon name="more" />
			{/snippet}

			<DropdownMenu.Sub>
				<DropdownMenu.SubTrigger>
					<HugeiconsIcon
						name="copy"
						class="h-4 w-4 mr-2"
						data-testid="skills-toolbar-copy-hugeicons-icon"
					/>
					Copy to
				</DropdownMenu.SubTrigger>
				<DropdownMenu.SubContent>
					<DropdownMenu.Item>Claude Code</DropdownMenu.Item>
				</DropdownMenu.SubContent>
			</DropdownMenu.Sub>
		</Selector>

		<div class="flex h-8 items-center rounded-md border border-border/50 px-2 text-sm">
			<HugeiconsIcon
				name="copy"
				class="h-4 w-4 mr-2"
				data-testid="skills-toolbar-copy-hugeicons-icon"
			/>
			Copy to
		</div>
	</div>
</section>
