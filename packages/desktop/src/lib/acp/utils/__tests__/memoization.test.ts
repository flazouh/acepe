import { beforeEach, describe, expect, it } from "bun:test";

import {
	clearMemoizationCaches,
	escapeHtml,
	getFileExtension,
	hashContent,
	LRUCache,
	memoize,
	normalizeLanguage,
} from "../memoization.js";

describe("LRUCache", () => {
	it("should store and retrieve values", () => {
		const cache = new LRUCache<string, number>(10);
		cache.set("a", 1);
		cache.set("b", 2);

		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBe(2);
		expect(cache.get("c")).toBeUndefined();
	});

	it("should evict oldest entry when max size is reached", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);
		cache.set("d", 4); // Should evict 'a'

		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBe(2);
		expect(cache.get("c")).toBe(3);
		expect(cache.get("d")).toBe(4);
		expect(cache.size).toBe(3);
	});

	it("should update LRU order on get", () => {
		const cache = new LRUCache<string, number>(3);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.set("c", 3);

		// Access 'a' to make it most recently used
		cache.get("a");

		// Add new item, should evict 'b' (now oldest)
		cache.set("d", 4);

		expect(cache.get("a")).toBe(1);
		expect(cache.get("b")).toBeUndefined();
		expect(cache.get("c")).toBe(3);
		expect(cache.get("d")).toBe(4);
	});

	it("should handle clear", () => {
		const cache = new LRUCache<string, number>(10);
		cache.set("a", 1);
		cache.set("b", 2);
		cache.clear();

		expect(cache.size).toBe(0);
		expect(cache.get("a")).toBeUndefined();
	});

	describe("performance", () => {
		it("should handle 10,000 insertions in under 50ms", () => {
			const cache = new LRUCache<string, number>(1000);
			const start = performance.now();

			for (let i = 0; i < 10_000; i++) {
				cache.set(`key-${i}`, i);
			}

			const elapsed = performance.now() - start;
			expect(elapsed).toBeLessThan(50);
			expect(cache.size).toBe(1000); // Should be at max size
		});
	});
});

describe("memoize", () => {
	it("should cache function results", () => {
		let callCount = 0;
		const expensive = memoize((x: string) => {
			callCount++;
			return x.toUpperCase();
		});

		expect(expensive("hello")).toBe("HELLO");
		expect(expensive("hello")).toBe("HELLO");
		expect(expensive("hello")).toBe("HELLO");
		expect(callCount).toBe(1); // Only called once
	});

	it("should handle multiple arguments", () => {
		let callCount = 0;
		const concat = memoize((a: string, b: string) => {
			callCount++;
			return a + b;
		});

		expect(concat("hello", "world")).toBe("helloworld");
		expect(concat("hello", "world")).toBe("helloworld");
		expect(concat("hello", "there")).toBe("hellothere");
		expect(callCount).toBe(2); // Different args = different calls
	});

	describe("performance", () => {
		it("should be faster on repeated calls", () => {
			const slowFn = memoize((x: string) => {
				let result = 0;
				for (let i = 0; i < 1000; i++) {
					result += x.charCodeAt(i % x.length);
				}
				return result;
			});

			// First call
			const start1 = performance.now();
			slowFn("test-string");
			const elapsed1 = performance.now() - start1;

			// Cached calls
			const start2 = performance.now();
			for (let i = 0; i < 1000; i++) {
				slowFn("test-string");
			}
			const elapsed2 = performance.now() - start2;

			// Cached calls should be at least 10x faster
			expect(elapsed2 / 1000).toBeLessThan(elapsed1 / 10);
		});
	});
});

describe("escapeHtml", () => {
	beforeEach(() => {
		clearMemoizationCaches();
	});

	it("should escape HTML special characters", () => {
		expect(escapeHtml("<div>")).toBe("&lt;div&gt;");
		expect(escapeHtml("a & b")).toBe("a &amp; b");
		expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
		expect(escapeHtml("it's")).toBe("it&#039;s");
	});

	it("should return unchanged string when no special chars", () => {
		const input = "Hello World 123";
		expect(escapeHtml(input)).toBe(input);
	});

	describe("performance", () => {
		it("should use fast path for strings without special chars", () => {
			const noSpecialChars = "const x = 123; function foo() { return bar; }";

			const start = performance.now();
			for (let i = 0; i < 10_000; i++) {
				escapeHtml(noSpecialChars);
			}
			const elapsed = performance.now() - start;

			// Should be very fast (< 20ms for 10k calls)
			expect(elapsed).toBeLessThan(20);
		});

		it("should cache repeated escapes", () => {
			const withSpecialChars = '<div class="test">Hello & goodbye</div>';

			// First call (uncached)
			escapeHtml(withSpecialChars);

			const start = performance.now();
			for (let i = 0; i < 10_000; i++) {
				escapeHtml(withSpecialChars);
			}
			const elapsed = performance.now() - start;

			// Cached lookups should be fast (< 10ms for 10k calls)
			expect(elapsed).toBeLessThan(10);
		});
	});
});

describe("hashContent", () => {
	it("should produce consistent hashes", () => {
		const content = "Hello, World!";
		const hash1 = hashContent(content);
		const hash2 = hashContent(content);

		expect(hash1).toBe(hash2);
	});

	it("should produce different hashes for different content", () => {
		const hash1 = hashContent("Hello");
		const hash2 = hashContent("World");

		expect(hash1).not.toBe(hash2);
	});

	it("should produce short hashes (base36)", () => {
		const hash = hashContent("Some longer content that would hash");
		expect(hash.length).toBeLessThanOrEqual(7); // Max 7 chars for 32-bit base36
	});

	describe("performance", () => {
		it("should hash 10,000 strings in under 50ms", () => {
			const strings = Array.from({ length: 10_000 }, (_, i) => `content-${i}`);

			const start = performance.now();
			for (const s of strings) {
				hashContent(s);
			}
			const elapsed = performance.now() - start;

			expect(elapsed).toBeLessThan(50);
		});

		it("should hash large strings efficiently", () => {
			const largeString = "x".repeat(100_000);

			const start = performance.now();
			for (let i = 0; i < 100; i++) {
				hashContent(largeString);
			}
			const elapsed = performance.now() - start;

			// Keep this bound loose enough for CI/sandbox variance while still
			// catching obvious performance regressions.
			expect(elapsed).toBeLessThan(250);
		});
	});
});

describe("normalizeLanguage", () => {
	it("should map file extensions to Shiki languages", () => {
		expect(normalizeLanguage("ts")).toBe("typescript");
		expect(normalizeLanguage("tsx")).toBe("tsx");
		expect(normalizeLanguage("js")).toBe("javascript");
		expect(normalizeLanguage("py")).toBe("python");
		expect(normalizeLanguage("rb")).toBe("ruby");
		expect(normalizeLanguage("rs")).toBe("rust");
	});

	it("should pass through already valid languages", () => {
		expect(normalizeLanguage("typescript")).toBe("typescript");
		expect(normalizeLanguage("javascript")).toBe("javascript");
		expect(normalizeLanguage("python")).toBe("python");
	});

	it("should return text for unknown extensions", () => {
		expect(normalizeLanguage("xyz")).toBe("text");
		expect(normalizeLanguage("unknown")).toBe("text");
	});

	it("should be case insensitive", () => {
		expect(normalizeLanguage("TS")).toBe("typescript");
		expect(normalizeLanguage("Py")).toBe("python");
	});
});

describe("getFileExtension", () => {
	it("should extract file extensions", () => {
		expect(getFileExtension("/path/to/file.ts")).toBe("ts");
		expect(getFileExtension("file.test.ts")).toBe("ts");
		expect(getFileExtension("README.md")).toBe("md");
	});

	it("should handle files without extensions", () => {
		expect(getFileExtension("Makefile")).toBe("");
		expect(getFileExtension("/path/to/noext")).toBe("");
	});

	it("should handle null/undefined", () => {
		expect(getFileExtension(null)).toBe("");
		expect(getFileExtension(undefined)).toBe("");
	});
});
