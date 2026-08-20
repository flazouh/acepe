import { describe, expect, it } from "vitest";
import {
	atomState,
	bindRuntime,
	componentScope,
	resource,
	runtime,
} from "./index.ts";

describe("package exports", () => {
	it("exports the four bridge functions", () => {
		expect(atomState).toBeTypeOf("function");
		expect(bindRuntime).toBeTypeOf("function");
		expect(Object.getOwnPropertyDescriptor(runtime, "runPromise")?.get).toBeTypeOf(
			"function",
		);
		expect(resource).toBeTypeOf("function");
		expect(componentScope).toBeTypeOf("function");
	});
});
