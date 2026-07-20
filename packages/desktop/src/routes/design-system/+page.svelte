<script lang="ts">
import DesignSystemPage from "$lib/components/dev/design-system-page.svelte";

function stayOnDesignSystem(): void {
	// Browser-only design-system route: there is no desktop shell to return to.
}
</script>

<div class="h-dvh overflow-hidden bg-background text-foreground">
	<DesignSystemPage onClose={stayOnDesignSystem} />
</div>
