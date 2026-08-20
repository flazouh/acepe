import { cleanup, render } from "@testing-library/svelte";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { flushSync, tick } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import { atomState } from "./atom.svelte.ts";
import AtomStateHost from "./atom-state-host.svelte";

afterEach(() => {
	cleanup();
});

const listenerCount = (
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<number>,
): number => {
	for (const node of registry.getNodes().values()) {
		if (node.atom === atom) {
			return node.listeners.size;
		}
	}
	return 0;
};

describe("atomState", () => {
	it("exposes a current getter", () => {
		const registry = AtomRegistry.make();
		const atom = Atom.make(0);
		const state = atomState(atom, registry);
		expect(Object.getOwnPropertyDescriptor(state, "current")?.get).toBeTypeOf(
			"function",
		);
		expect(state.current).toBe(0);
	});

	it("mounts, pushes three values, then releases the subscription on unmount", async () => {
		const registry = AtomRegistry.make();
		const atom = Atom.make(0);
		const view = render(AtomStateHost, {
			props: {
				atom,
				registry,
			},
		});
		flushSync();

		expect(view.getByTestId("atom-value").textContent).toBe("0");
		expect(listenerCount(registry, atom)).toBeGreaterThan(0);

		registry.set(atom, 1);
		flushSync();
		expect(view.getByTestId("atom-value").textContent).toBe("1");

		registry.set(atom, 2);
		flushSync();
		expect(view.getByTestId("atom-value").textContent).toBe("2");

		registry.set(atom, 3);
		flushSync();
		expect(view.getByTestId("atom-value").textContent).toBe("3");

		view.unmount();
		flushSync();
		await tick();
		expect(listenerCount(registry, atom)).toBe(0);
	});
});
