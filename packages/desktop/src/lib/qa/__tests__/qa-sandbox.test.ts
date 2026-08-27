import { describe, expect, it } from "bun:test";
import { isQaSandboxedSearch } from "../qa-sandbox.ts";

describe("the QA sandbox rule", () => {
	it("is off for the normal app", () => {
		expect(isQaSandboxedSearch("")).toBe(false);
		expect(isQaSandboxedSearch("?scaffold=1")).toBe(false);
	});

	/**
	 * Derived from the URL rather than a flag someone has to set: a replay is
	 * sandboxed from its first line of code, with no window in which it could
	 * write to the workspace the user comes back to.
	 */
	it("is on for any page replaying a scenario", () => {
		expect(isQaSandboxedSearch("?qa=streaming-reply")).toBe(true);
		expect(isQaSandboxedSearch("?qa=tool-and-approval&rate=0")).toBe(true);
	});
});
