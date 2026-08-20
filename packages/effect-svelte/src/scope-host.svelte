<script lang="ts">
	import type * as Scope from "effect/Scope";
	import { untrack } from "svelte";
	import { componentScope } from "./scope.ts";

	let {
		onReady,
	}: {
		onReady: (scope: Scope.Closeable) => void;
	} = $props();

	const scope = componentScope();
	untrack(() => {
		onReady(scope);
	});
</script>
