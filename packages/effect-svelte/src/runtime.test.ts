import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { describe, expect, it } from "vitest";
import { bindRuntime, RuntimeAlreadyBound, runtime } from "./runtime.ts";

describe("runtime", () => {
	it("binds runPromise to the single ManagedRuntime", () => {
		const managed = bindRuntime(Layer.empty);
		expect(ManagedRuntime.isManagedRuntime(managed)).toBe(true);
		expect(runtime.runPromise).toBe(managed.runPromise);
	});

	it("refuses a second ManagedRuntime", () => {
		expect(() => bindRuntime(Layer.empty)).toThrow(RuntimeAlreadyBound);
	});
});
