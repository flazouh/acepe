#!/usr/bin/env bun

/// <reference types="bun-types" />

/**
 * Test Timing Analysis Script
 *
 * This script runs your tests and analyzes which tests are taking the most time.
 * It provides various sorting and filtering options to help identify performance bottlenecks.
 */

type TestResult = {
	testName: string;
	duration: number;
	status: "pass" | "fail" | "skip";
	file: string;
};

// Regex pattern for parsing test output format: (pass) TestName > description [duration]
const TEST_OUTPUT_REGEX = /^\((\w+)\)\s+(.+?)\s+\[(\d+\.?\d*)ms\]$/;

function parseTestOutput(output: string): TestResult[] {
	const results: TestResult[] = [];
	const lines = output.split("\n");

	for (const line of lines) {
		// Match test output format: (pass) TestName > description [duration]
		const match = line.match(TEST_OUTPUT_REGEX);
		if (match) {
			const [, status, testName, duration] = match;
			if (!(testName && duration)) {
				continue;
			}

			const file = line.includes("src/")
				? line.split("src/")[1]?.split(":")[0] || "unknown"
				: "unknown";

			results.push({
				testName: testName.trim(),
				duration: Number.parseFloat(duration),
				status: status as "pass" | "fail" | "skip",
				file: `src/${file}`,
			});
		}
	}

	return results;
}

function formatDuration(ms: number): string {
	if (ms >= 1000) {
		return `${(ms / 1000).toFixed(2)}s`;
	}
	return `${ms.toFixed(2)}ms`;
}

function printResults(results: TestResult[], title: string, limit = 20) {
	console.log(`\n${title}`);
	console.log("=".repeat(title.length));

	if (results.length === 0) {
		console.log("No tests found matching criteria.");
		return;
	}

	for (const [index, result] of results.slice(0, limit).entries()) {
		const duration = formatDuration(result.duration);
		let status: string;
		if (result.status === "pass") {
			status = "✅";
		} else if (result.status === "fail") {
			status = "❌";
		} else {
			status = "⏭️";
		}
		console.log(
			`${(index + 1).toString().padStart(2)}. ${status} ${duration.padStart(8)} - ${result.testName}`
		);
		console.log(`    📁 ${result.file}`);
	}

	if (results.length > limit) {
		console.log(`\n... and ${results.length - limit} more tests`);
	}
}

async function runTests(): Promise<string> {
	try {
		const proc = Bun.spawn(["bun", "test"], {
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, AGENT: "1" },
		});

		const output = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		await proc.exited;

		// Return output regardless of exit code to analyze timing even with failures
		return output + stderr;
	} catch (error) {
		throw new Error(`Failed to run tests: ${error}`);
	}
}

async function main() {
	const args = process.argv.slice(2);
	const help = args.includes("--help") || args.includes("-h");

	if (help) {
		console.log(`
Test Timing Analysis Tool

Usage: bun run scripts/analyze-test-timing.ts [options]

Options:
  --help, -h          Show this help message
  --slowest N         Show N slowest tests (default: 20)
  --fastest N         Show N fastest tests (default: 20)
  --threshold MS      Show tests slower than MS milliseconds
  --file PATTERN      Filter tests by file pattern
  --summary           Show summary statistics only

Examples:
  bun run scripts/analyze-test-timing.ts --slowest 10
  bun run scripts/analyze-test-timing.ts --threshold 50
  bun run scripts/analyze-test-timing.ts --file "netflix" --slowest 5
  bun run scripts/analyze-test-timing.ts --summary
`);
		return;
	}

	console.log("🧪 Running tests and analyzing timing...\n");

	try {
		const output = await runTests();
		const results = parseTestOutput(output);

		if (results.length === 0) {
			console.log("❌ No test results found. Make sure tests are running correctly.");
			return;
		}

		// Parse command line arguments
		const slowestCount = Number.parseInt(
			args.find((arg) => arg.startsWith("--slowest="))?.split("=")[1] || "20",
			10
		);
		const fastestCount = Number.parseInt(
			args.find((arg) => arg.startsWith("--fastest="))?.split("=")[1] || "20",
			10
		);
		const threshold = Number.parseInt(
			args.find((arg) => arg.startsWith("--threshold="))?.split("=")[1] || "0",
			10
		);
		const filePattern = args.find((arg) => arg.startsWith("--file="))?.split("=")[1];
		const summaryOnly = args.includes("--summary");

		// Filter results
		let filteredResults = results;
		if (filePattern) {
			filteredResults = results.filter((result) =>
				result.file.toLowerCase().includes(filePattern.toLowerCase())
			);
		}
		if (threshold > 0) {
			filteredResults = filteredResults.filter((result) => result.duration >= threshold);
		}

		if (summaryOnly) {
			const totalTests = results.length;
			const totalTime = results.reduce((sum, result) => sum + result.duration, 0);
			const avgTime = totalTime / totalTests;
			const slowest = Math.max(...results.map((r) => r.duration));
			const fastest = Math.min(...results.map((r) => r.duration));

			console.log("📊 Test Summary Statistics");
			console.log("========================");
			console.log(`Total tests: ${totalTests}`);
			console.log(`Total time: ${formatDuration(totalTime)}`);
			console.log(`Average time: ${formatDuration(avgTime)}`);
			console.log(`Slowest test: ${formatDuration(slowest)}`);
			console.log(`Fastest test: ${formatDuration(fastest)}`);

			// Show distribution
			const slowTests = results.filter((r) => r.duration >= 10).length;
			const mediumTests = results.filter((r) => r.duration >= 1 && r.duration < 10).length;
			const fastTests = results.filter((r) => r.duration < 1).length;

			console.log("\nDistribution:");
			console.log(`  Slow (≥10ms): ${slowTests} tests`);
			console.log(`  Medium (1-10ms): ${mediumTests} tests`);
			console.log(`  Fast (<1ms): ${fastTests} tests`);
		} else {
			// Show detailed results
			const slowestTests = [...filteredResults].sort((a, b) => b.duration - a.duration);
			const fastestTests = [...filteredResults].sort((a, b) => a.duration - b.duration);

			printResults(
				slowestTests,
				`🐌 Slowest ${Math.min(slowestCount, slowestTests.length)} Tests`,
				slowestCount
			);
			printResults(
				fastestTests,
				`⚡ Fastest ${Math.min(fastestCount, fastestTests.length)} Tests`,
				fastestCount
			);

			if (threshold > 0) {
				const slowTests = results.filter((r) => r.duration >= threshold);
				printResults(slowTests, `⏰ Tests Slower Than ${formatDuration(threshold)}`, 50);
			}

			// Show summary
			const totalTime = results.reduce((sum, result) => sum + result.duration, 0);
			const avgTime = totalTime / results.length;
			console.log(
				`\n📊 Summary: ${results.length} tests, ${formatDuration(totalTime)} total, ${formatDuration(avgTime)} average`
			);
		}
	} catch (error) {
		console.error("❌ Error running tests:", error);
		process.exit(1);
	}
}

main().catch(console.error);
