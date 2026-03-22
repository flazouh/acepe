<script lang="ts">
import EmbeddedModalShell from "./embedded-modal-shell.svelte";

interface Props {
	open: boolean;
	keepMounted?: boolean;
}

let { open, keepMounted = false }: Props = $props();
</script>

<EmbeddedModalShell
	{open}
	{keepMounted}
	ariaLabel="Harness modal"
	panelClass="test-panel"
>
	<div data-testid="shell-content">Harness content</div>
</EmbeddedModalShell>
