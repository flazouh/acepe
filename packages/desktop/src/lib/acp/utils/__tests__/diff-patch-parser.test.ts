import { describe, expect, it } from "bun:test";

import { parsePatchToBeforeAfter } from "../diff-patch-parser.js";

describe("diff-patch-parser", () => {
	describe("simple modifications", () => {
		it("should parse a simple modification", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain("const y = 2;");
				expect(result.value.after).toContain("const y = 3;");
				expect(result.value.hunks.length).toBe(1);
				expect(result.value.hunks[0].oldStart).toBe(1);
				expect(result.value.hunks[0].newStart).toBe(1);
			}
		});

		it("should handle multiple hunks in one file", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line 1
-line 2
+line 2 modified
 line 3
@@ -10,3 +10,3 @@
 line 10
-line 11
+line 11 modified
 line 12`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.hunks.length).toBe(2);
				expect(result.value.hunks[0].oldStart).toBe(1);
				expect(result.value.hunks[1].oldStart).toBe(10);
			}
		});
	});

	describe("file additions", () => {
		it("should handle new files (additions only)", () => {
			const patch = `--- /dev/null
+++ b/new-file.ts
@@ -0,0 +1,3 @@
+function hello() {
+  console.log("world");
+}`;

			const result = parsePatchToBeforeAfter(patch, "added");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toBe("");
				expect(result.value.after).toContain("function hello()");
				expect(result.value.after).toContain("console.log");
				expect(result.value.hunks.length).toBe(1);
			}
		});
	});

	describe("file deletions", () => {
		it("should handle deleted files (deletions only)", () => {
			const patch = `--- a/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-function goodbye() {
-  console.log("cruel world");
-}`;

			const result = parsePatchToBeforeAfter(patch, "deleted");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain("function goodbye()");
				expect(result.value.after).toBe("");
				expect(result.value.hunks.length).toBe(1);
			}
		});
	});

	describe("edge cases", () => {
		it("should handle empty patch for mode-only changes", () => {
			const patch = `--- a/script.sh
+++ b/script.sh`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toBe("");
				expect(result.value.after).toBe("");
				expect(result.value.hunks.length).toBe(0);
			}
		});

		it("should detect binary files", () => {
			const patch = `Binary files a/image.png and b/image.png differ`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isErr()).toBe(true);

			if (result.isErr()) {
				expect(result.error.type).toBe("binary_file");
			}
		});

		it("should handle lines with content starting with special chars", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 // comment
-const x = "- string";
+const x = "- new string";
 // more comment`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain('const x = "- string";');
				expect(result.value.after).toContain('const x = "- new string";');
			}
		});

		it("should handle patches with no context lines", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -1 +1 @@
-old
+new`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain("old");
				expect(result.value.after).toContain("new");
			}
		});

		it("should handle hunks with only additions", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -5,0 +5,3 @@
+added line 1
+added line 2
+added line 3`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.after).toContain("added line 1");
				expect(result.value.hunks[0].oldCount).toBe(0);
				expect(result.value.hunks[0].newCount).toBe(3);
			}
		});

		it("should handle hunks with only deletions", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +0,0 @@
-deleted line 1
-deleted line 2
-deleted line 3`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain("deleted line 1");
				expect(result.value.hunks[0].oldCount).toBe(3);
				expect(result.value.hunks[0].newCount).toBe(0);
			}
		});

		it("should preserve line structure with context", () => {
			const patch = `--- a/test.js
+++ b/test.js
@@ -1,5 +1,5 @@
 function test() {
   const x = 1;
-  console.log(x);
+  console.log(x + 1);
   const y = 2;
 }`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain("function test()");
				expect(result.value.before).toContain("const y = 2;");
				expect(result.value.after).toContain("console.log(x + 1);");
			}
		});
	});

	describe("real-world scenarios", () => {
		it("should handle TypeScript file modification", () => {
			const patch = `--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,10 +1,11 @@
 export function add(a: number, b: number): number {
   return a + b;
 }

-export function subtract(a: number, b: number): number {
+export function subtract(a: number, b: number): number {
+  // TODO: implement
   return a - b;
 }

 export function multiply(a: number, b: number): number {
   return a * b;
 }`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain("export function subtract");
				expect(result.value.after).toContain("TODO: implement");
			}
		});

		it("should handle mixed additions and deletions", () => {
			const patch = `--- a/config.json
+++ b/config.json
@@ -1,5 +1,6 @@
 {
   "name": "test",
-  "version": "1.0.0",
+  "version": "2.0.0",
+  "updated": true,
   "debug": false
 }`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.before).toContain('"version": "1.0.0"');
				expect(result.value.after).toContain('"version": "2.0.0"');
				expect(result.value.after).toContain('"updated": true');
			}
		});
	});

	describe("hunk header parsing", () => {
		it("should correctly parse hunk headers with count 1", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -5 +5 @@
-old
+new`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.hunks[0].oldStart).toBe(5);
				expect(result.value.hunks[0].oldCount).toBe(1);
				expect(result.value.hunks[0].newStart).toBe(5);
				expect(result.value.hunks[0].newCount).toBe(1);
			}
		});

		it("should correctly parse hunk headers with explicit counts", () => {
			const patch = `--- a/file.ts
+++ b/file.ts
@@ -10,5 +10,6 @@
 line 10
-line 11
+line 11a
+line 11b
 line 12
 line 13
 line 14`;

			const result = parsePatchToBeforeAfter(patch, "modified");
			expect(result.isOk()).toBe(true);

			if (result.isOk()) {
				expect(result.value.hunks[0].oldStart).toBe(10);
				expect(result.value.hunks[0].oldCount).toBe(5);
				expect(result.value.hunks[0].newStart).toBe(10);
				expect(result.value.hunks[0].newCount).toBe(6);
			}
		});
	});
});
