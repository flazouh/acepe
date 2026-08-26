import { describe, expect, it } from "bun:test";
import { readQaMode } from "../qa-mode.ts";

describe("readQaMode", () => {
	it("is off when the url says nothing about qa", () => {
		expect(readQaMode("")).toBeNull();
		expect(readQaMode("?scaffold=1")).toBeNull();
	});

	it("an empty scenario name does not turn qa mode on", () => {
		expect(readQaMode("?qa=")).toBeNull();
	});

	it("defaults to capture speed, playing", () => {
		expect(readQaMode("?qa=streaming-reply")).toEqual({
			scenario: "streaming-reply",
			rate: 1,
			autoPlay: true,
		});
	});

	it("autoplay=0 parks the scenario so a script can step it", () => {
		expect(readQaMode("?qa=streaming-reply&autoplay=0")?.autoPlay).toBe(false);
	});

	it("rate 0 removes every delay", () => {
		expect(readQaMode("?qa=streaming-reply&rate=0")?.rate).toBe(0);
	});

	it("a nonsense rate falls back to capture speed rather than breaking playback", () => {
		expect(readQaMode("?qa=streaming-reply&rate=fast")?.rate).toBe(1);
		expect(readQaMode("?qa=streaming-reply&rate=-2")?.rate).toBe(1);
	});

	it("keeps working alongside the other boot flags", () => {
		expect(readQaMode("?scaffold=1&qa=tool-and-approval&rate=2")).toEqual({
			scenario: "tool-and-approval",
			rate: 2,
			autoPlay: true,
		});
	});
});
