import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { onDestroy } from "svelte";

export const componentScope = (): Scope.Closeable => {
	const scope = Scope.makeUnsafe();
	onDestroy(() => {
		Effect.runSync(Scope.close(scope, Exit.void));
	});
	return scope;
};
