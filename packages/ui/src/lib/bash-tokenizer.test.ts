import { describe, expect, it } from "bun:test";

import { splitCommandSegments } from "./bash-tokenizer.js";

describe("splitCommandSegments", () => {
	it("splits pipelines on single |", () => {
		expect(splitCommandSegments("git status | grep foo")).toEqual([
			"git status",
			"grep foo",
		]);
	});

	it("splits multi-stage pipelines", () => {
		expect(splitCommandSegments("a | b | c")).toEqual(["a", "b", "c"]);
	});

	it("does not split || into two pipe breaks", () => {
		expect(splitCommandSegments("false || echo ok")).toEqual([
			"false",
			"echo ok",
		]);
	});

	it("does not split | inside single quotes", () => {
		expect(splitCommandSegments("echo '|' | cat")).toEqual([
			"echo '|'",
			"cat",
		]);
	});

	it("does not split | inside double quotes", () => {
		expect(splitCommandSegments('echo "|" | wc')).toEqual(['echo "|"', "wc"]);
	});

	it("combines && and | splits", () => {
		expect(splitCommandSegments("a && b | c")).toEqual(["a", "b", "c"]);
	});
});
