<script lang="ts">
	import type * as Atom from "effect/unstable/reactivity/Atom";
	import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
	import { atomState } from "./atom.svelte.ts";

	let {
		atom,
		registry,
	}: {
		atom: Atom.Atom<number>;
		registry: AtomRegistry.AtomRegistry;
	} = $props();

	const state = $derived(atomState(atom, registry));
</script>

<span data-testid="atom-value">{state.current}</span>
