<script lang="ts">
	import type { Resource } from "./resource.ts";

	let {
		state,
	}: {
		state: Resource<string, { readonly _tag: string }>;
	} = $props();
</script>

<span data-testid="resource-loading">{String(state.loading)}</span>
<span data-testid="resource-success">{state.success ?? ""}</span>
<span data-testid="resource-failure">{state.failure?._tag ?? ""}</span>
