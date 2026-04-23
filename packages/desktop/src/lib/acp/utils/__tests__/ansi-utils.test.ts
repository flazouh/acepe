import { describe, expect, it } from "bun:test";

import { stripAnsiCodes } from "../ansi-utils.js";

describe("stripAnsiCodes", () => {
	it("should remove basic color codes", () => {
		expect(stripAnsiCodes("\u001b[31mred text\u001b[0m")).toBe("red text");
		expect(stripAnsiCodes("\u001b[32mgreen\u001b[0m")).toBe("green");
		expect(stripAnsiCodes("\u001b[34mblue\u001b[0m")).toBe("blue");
	});

	it("should remove 256-color codes", () => {
		expect(stripAnsiCodes("\u001b[38;5;196mbright red\u001b[0m")).toBe("bright red");
		expect(stripAnsiCodes("\u001b[48;5;226myellow background\u001b[0m")).toBe("yellow background");
	});

	it("should remove true color (24-bit) codes", () => {
		expect(stripAnsiCodes("\u001b[38;2;255;0;0mrgb red\u001b[0m")).toBe("rgb red");
		expect(stripAnsiCodes("\u001b[48;2;0;255;0mgreen bg\u001b[0m")).toBe("green bg");
	});

	it("should remove formatting codes", () => {
		expect(stripAnsiCodes("\u001b[1mbold\u001b[0m")).toBe("bold");
		expect(stripAnsiCodes("\u001b[4munderline\u001b[0m")).toBe("underline");
		expect(stripAnsiCodes("\u001b[7mreverse\u001b[0m")).toBe("reverse");
	});

	it("should remove cursor movement codes", () => {
		expect(stripAnsiCodes("\u001b[2Jclear screen")).toBe("clear screen");
		expect(stripAnsiCodes("\u001b[Hmove to top")).toBe("move to top");
		expect(stripAnsiCodes("\u001b[10;20Hmove to position")).toBe("move to position");
	});

	it("should remove erase codes", () => {
		expect(stripAnsiCodes("\u001b[Kerase line\u001b[0K")).toBe("erase line");
		expect(stripAnsiCodes("\u001b[2Kerase screen")).toBe("erase screen");
	});

	it("should handle multiple ANSI codes in sequence", () => {
		const input = "\u001b[31m\u001b[1m\u001b[4mbold red underline\u001b[0m";
		expect(stripAnsiCodes(input)).toBe("bold red underline");
	});

	it("should handle ANSI codes mixed with regular text", () => {
		const input = "Start \u001b[32mgreen\u001b[0m middle \u001b[34mblue\u001b[0m end";
		expect(stripAnsiCodes(input)).toBe("Start green middle blue end");
	});

	it("should handle incomplete ANSI sequences", () => {
		// Note: \u001b[31u is technically a valid ANSI sequence, so it gets stripped
		expect(stripAnsiCodes("\u001b[31unfinished")).toBe("nfinished");
		expect(stripAnsiCodes("\u001b[38;5;196incomplete")).toBe("ncomplete");
		expect(stripAnsiCodes("\u001b[malone")).toBe("alone");
		expect(stripAnsiCodes("\u001b[")).toBe("\u001b[");
		expect(stripAnsiCodes("\u001b[123")).toBe("\u001b[123");
	});

	it("should handle empty strings", () => {
		expect(stripAnsiCodes("")).toBe("");
	});

	it("should return unchanged strings without ANSI codes", () => {
		const input = "Hello, World! This is plain text.";
		expect(stripAnsiCodes(input)).toBe(input);
	});

	it("should handle strings with only ANSI codes", () => {
		expect(stripAnsiCodes("\u001b[31m\u001b[0m")).toBe("");
		expect(stripAnsiCodes("\u001b[1m\u001b[4m\u001b[0m")).toBe("");
	});

	it("should handle complex terminal output", () => {
		const terminalOutput = `
\u001b[32m$ \u001b[0m\u001b[1mls -la\u001b[0m
\u001b[34mdrwxr-xr-x\u001b[0m  12 user  group   384 Jan 15 10:30 \u001b[1;34m.\u001b[0m
\u001b[34mdrwxr-xr-x\u001b[0m   4 user  group   128 Jan 15 09:45 \u001b[1;34m..\u001b[0m
\u001b[32m-rw-r--r--\u001b[0m   1 user  group  1024 Jan 15 10:15 \u001b[0mfile.txt\u001b[0m
    `.trim();

		const expected = `
$ ls -la
drwxr-xr-x  12 user  group   384 Jan 15 10:30 .
drwxr-xr-x   4 user  group   128 Jan 15 09:45 ..
-rw-r--r--   1 user  group  1024 Jan 15 10:15 file.txt
    `.trim();

		expect(stripAnsiCodes(terminalOutput)).toBe(expected);
	});

	it("should handle ANSI codes at string boundaries", () => {
		expect(stripAnsiCodes("\u001b[31mstart")).toBe("start");
		expect(stripAnsiCodes("end\u001b[0m")).toBe("end");
		expect(stripAnsiCodes("\u001b[32m\u001b[0m")).toBe("");
	});

	describe("performance", () => {
		it("should process 1,000 strings quickly", () => {
			const strings = Array.from(
				{ length: 1000 },
				(_, i) => `\u001b[3${i % 8}mcolored text ${i}\u001b[0m`
			);

			const start = performance.now();
			for (const s of strings) {
				stripAnsiCodes(s);
			}
			const elapsed = performance.now() - start;

			// Should complete in under 10ms
			expect(elapsed).toBeLessThan(10);
		});

		it("should handle large strings efficiently", () => {
			// Create a large string with many ANSI codes
			const parts = Array.from(
				{ length: 1000 },
				(_, i) => `\u001b[${30 + (i % 8)}mchunk ${i}\u001b[0m `
			);
			const largeString = parts.join("");

			const start = performance.now();
			for (let i = 0; i < 100; i++) {
				stripAnsiCodes(largeString);
			}
			const elapsed = performance.now() - start;

			// Should complete in under 50ms for 100 operations on ~50KB string
			expect(elapsed).toBeLessThan(50);
		});

		it("should be fast on strings without ANSI codes", () => {
			const plainText = "This is a long string without any ANSI escape codes. ".repeat(1000);
			const measureBatch = (iterations: number): number => {
				const start = performance.now();
				for (let i = 0; i < iterations; i++) {
					stripAnsiCodes(plainText);
				}
				return performance.now() - start;
			};
			const getMedian = (values: number[]): number => {
				const sorted = values.slice().sort((a, b) => a - b);
				return sorted[Math.floor(sorted.length / 2)] as number;
			};

			measureBatch(50);

			const shortBatchSamples: number[] = [];
			const longBatchSamples: number[] = [];

			for (let sample = 0; sample < 5; sample++) {
				shortBatchSamples.push(measureBatch(250));
				longBatchSamples.push(measureBatch(1000));
			}

			const shortBatchMedian = getMedian(shortBatchSamples);
			const longBatchMedian = getMedian(longBatchSamples);
			const shortPerIterationMedian = shortBatchMedian / 250;
			const longPerIterationMedian = longBatchMedian / 1000;

			// Compare per-iteration cost rather than raw wall-clock totals so the
			// check stays stable on slower shared CI runners while still catching
			// regressions in the no-ANSI fast path.
			expect(longPerIterationMedian).toBeLessThan(shortPerIterationMedian * 2.5);
		});
	});
});
