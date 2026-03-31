<script lang="ts">
interface Props {
	onclick?: (event: MouseEvent) => void;
	onmouseenter?: (event: MouseEvent) => void;
	onfocus?: (event: FocusEvent) => void;
	insertions?: number;
	deletions?: number;
	loading?: boolean;
}

let {
	onclick,
	onmouseenter,
	onfocus,
	insertions = 0,
	deletions = 0,
	loading = false,
}: Props = $props();
</script>

<button
	type="button"
	data-testid="github-badge"
	onclick={onclick}
	onmouseenter={onmouseenter}
	onfocus={onfocus}
>
	<span data-testid="insertions">{insertions}</span>
	<span data-testid="deletions">{deletions}</span>
	<span data-testid="loading">{loading ? "loading" : "idle"}</span>
</button>