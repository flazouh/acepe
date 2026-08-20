import { cleanup, render } from "@testing-library/svelte";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import { flushSync } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import ScopeHost from "./scope-host.svelte";

afterEach(() => {
	cleanup();
});

describe("componentScope", () => {
	it("closes the Effect Scope when the component is destroyed", () => {
		const released: Array<string> = [];
		let scope: Scope.Closeable | undefined;
		const view = render(ScopeHost, {
			props: {
				onReady: (next) => {
					scope = next;
					Effect.runSync(
						Scope.addFinalizer(
							next,
							Effect.sync(() => {
								released.push("released");
							}),
						),
					);
				},
			},
		});
		flushSync();
		expect(scope).toBeDefined();
		expect(released).toEqual([]);

		view.unmount();
		flushSync();
		expect(released).toEqual(["released"]);
	});
});
