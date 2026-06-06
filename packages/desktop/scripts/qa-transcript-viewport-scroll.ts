import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const TAURI_MCP_CLI_VERSION = "@hypothesi/tauri-mcp-cli@0.10.0";
const DEFAULT_APP_IDENTIFIER = "9223";
const DEFAULT_ITERATIONS = 5;
const DEFAULT_SETTLE_MS = 1_200;
const DEFAULT_BOTTOM_SETTLE_MS = 800;
const DEFAULT_CALL_TIMEOUT_MS = 90_000;
const DEFAULT_MIN_VIEWPORTS = 2;
const MAX_ALLOWED_TOP_GAP_PX = 64;
const MAX_ALLOWED_BOTTOM_DISTANCE_PX = 512;

const snapshotSchema = z.object({
	panel: z.number(),
	domIndex: z.number(),
	left: z.number(),
	scrollTop: z.number(),
	maxTop: z.number(),
	scrollHeight: z.number(),
	clientHeight: z.number(),
	bufferStartIndex: z.number().nullable(),
	bufferEndIndex: z.number().nullable(),
	bufferLayoutRowCount: z.number().nullable(),
	bufferTopPx: z.number().nullable(),
	bufferEndPx: z.number().nullable(),
	bufferEmissionSeq: z.number().nullable(),
	bufferMode: z.string().nullable(),
	rows: z.number(),
	visibleRowCount: z.number(),
	firstId: z.string().nullable(),
	firstTopDeltaPx: z.number().nullable(),
	lastId: z.string().nullable(),
	lastBottomDeltaPx: z.number().nullable(),
	blankTopGapPx: z.number(),
});

const violationSchema = z.object({
	iteration: z.number(),
	stage: z.string(),
	panel: z.number(),
	code: z.string(),
	message: z.string(),
	snapshot: snapshotSchema,
});

const scenarioSchema = z.object({
	ok: z.boolean(),
	iterations: z.number(),
	viewportCount: z.number(),
	maxBlankTopGapPx: z.number(),
	maxSettleScrollTopPx: z.number(),
	violations: z.array(violationSchema),
	records: z.array(
		z.object({
			iteration: z.number(),
			initial: z.array(snapshotSchema),
			bottom: z.array(snapshotSchema),
			immediate: z.array(snapshotSchema),
			settleSamples: z.array(snapshotSchema),
			after: z.array(snapshotSchema),
		})
	),
});

type ScenarioResult = z.infer<typeof scenarioSchema>;

function numberArg(name: string, fallback: number): number {
	const prefix = `${name}=`;
	const value = process.argv.find((arg) => arg.startsWith(prefix));
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value.slice(prefix.length));
	if (Number.isFinite(parsed) && parsed > 0) {
		return parsed;
	}
	return fallback;
}

function stringArg(name: string, fallback: string): string {
	const prefix = `${name}=`;
	const value = process.argv.find((arg) => arg.startsWith(prefix));
	if (value === undefined) {
		return fallback;
	}
	const parsed = value.slice(prefix.length).trim();
	return parsed.length > 0 ? parsed : fallback;
}

function boolArg(name: string): boolean {
	return process.argv.includes(name);
}

async function runCommand(command: readonly string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
	const child = Bun.spawn(command, {
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(child.stdout).text();
	const stderr = await new Response(child.stderr).text();
	const code = await child.exited;
	return { code, stdout, stderr };
}

async function runTauri(args: readonly string[]): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }> {
	return runCommand(["npx", "-y", "-p", TAURI_MCP_CLI_VERSION, "tauri-mcp"].concat(args));
}

function unwrapTauriText(stdout: string): string {
	const parsed = JSON.parse(stdout);
	const wrapper = z
		.object({
			content: z.array(z.object({ text: z.string() })).optional(),
			text: z.string().optional(),
		})
		.parse(parsed);
	const firstContent = wrapper.content?.[0]?.text;
	return firstContent ?? wrapper.text ?? stdout;
}

function jsonObjectPrefix(text: string): string | null {
	const start = text.indexOf("{");
	if (start < 0) {
		return null;
	}
	let depth = 0;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (char === "{") {
			depth += 1;
		}
		if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				return text.slice(start, index + 1);
			}
		}
	}
	return null;
}

function scenarioScript(input: {
	readonly iterations: number;
	readonly iterationOffset: number;
	readonly bottomSettleMs: number;
	readonly settleMs: number;
	readonly maxAllowedTopGapPx: number;
}): string {
	return `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const iterations = ${input.iterations};
  const iterationOffset = ${input.iterationOffset};
  const bottomSettleMs = ${input.bottomSettleMs};
  const settleMs = ${input.settleMs};
  const maxAllowedTopGapPx = ${input.maxAllowedTopGapPx};

  const numberData = (el, key) => {
    const raw = el.dataset[key];
    if (raw === undefined || raw === "") {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const readViewports = () => Array.from(document.querySelectorAll("[data-testid=rust-transcript-viewport]"))
    .map((el, domIndex) => {
      const viewportRect = el.getBoundingClientRect();
      const rows = Array.from(el.querySelectorAll("[data-entry-key]"));
      const first = rows[0] || null;
      const last = rows[rows.length - 1] || null;
      const firstRect = first ? first.getBoundingClientRect() : null;
      const lastRect = last ? last.getBoundingClientRect() : null;
      const firstTopDeltaPx = firstRect ? Math.round(firstRect.top - viewportRect.top) : null;
      const lastBottomDeltaPx = lastRect ? Math.round(lastRect.bottom - viewportRect.top) : null;
      let visibleRowCount = 0;
      for (const row of rows) {
        const rowRect = row.getBoundingClientRect();
        if (rowRect.bottom > viewportRect.top && rowRect.top < viewportRect.bottom) {
          visibleRowCount += 1;
        }
      }
      return {
        el,
        panel: 0,
        domIndex,
        left: Math.round(viewportRect.left),
        visible: viewportRect.width > 0 && viewportRect.height > 0,
        scrollTop: Math.round(el.scrollTop),
        maxTop: Math.round(el.scrollHeight - el.clientHeight),
        scrollHeight: Math.round(el.scrollHeight),
        clientHeight: Math.round(el.clientHeight),
        bufferStartIndex: numberData(el, "bufferStartIndex"),
        bufferEndIndex: numberData(el, "bufferEndIndex"),
        bufferLayoutRowCount: numberData(el, "bufferLayoutRowCount"),
        bufferTopPx: numberData(el, "bufferTopPx"),
        bufferEndPx: numberData(el, "bufferEndPx"),
        bufferEmissionSeq: numberData(el, "bufferEmissionSeq"),
        bufferMode: el.dataset.bufferMode || null,
        rows: rows.length,
        visibleRowCount,
        firstId: first ? first.getAttribute("data-entry-key") : null,
        firstTopDeltaPx,
        lastId: last ? last.getAttribute("data-entry-key") : null,
        lastBottomDeltaPx,
        blankTopGapPx: firstTopDeltaPx === null ? 0 : Math.max(0, firstTopDeltaPx),
      };
    })
    .filter((snapshot) => snapshot.visible && snapshot.maxTop > 0)
    .sort((a, b) => a.left - b.left)
    .map((snapshot, panel) => ({
      el: snapshot.el,
      panel,
      domIndex: snapshot.domIndex,
      left: snapshot.left,
      scrollTop: snapshot.scrollTop,
      maxTop: snapshot.maxTop,
      scrollHeight: snapshot.scrollHeight,
      clientHeight: snapshot.clientHeight,
      bufferStartIndex: snapshot.bufferStartIndex,
      bufferEndIndex: snapshot.bufferEndIndex,
      bufferLayoutRowCount: snapshot.bufferLayoutRowCount,
      bufferTopPx: snapshot.bufferTopPx,
      bufferEndPx: snapshot.bufferEndPx,
      bufferEmissionSeq: snapshot.bufferEmissionSeq,
      bufferMode: snapshot.bufferMode,
      rows: snapshot.rows,
      visibleRowCount: snapshot.visibleRowCount,
      firstId: snapshot.firstId,
      firstTopDeltaPx: snapshot.firstTopDeltaPx,
      lastId: snapshot.lastId,
      lastBottomDeltaPx: snapshot.lastBottomDeltaPx,
      blankTopGapPx: snapshot.blankTopGapPx,
    }));

  const publicSnapshots = () => {
    const snapshots = [];
    for (const snapshot of readViewports()) {
      snapshots.push({
        panel: snapshot.panel,
        domIndex: snapshot.domIndex,
        left: snapshot.left,
        scrollTop: snapshot.scrollTop,
        maxTop: snapshot.maxTop,
        scrollHeight: snapshot.scrollHeight,
        clientHeight: snapshot.clientHeight,
        bufferStartIndex: snapshot.bufferStartIndex,
        bufferEndIndex: snapshot.bufferEndIndex,
        bufferLayoutRowCount: snapshot.bufferLayoutRowCount,
        bufferTopPx: snapshot.bufferTopPx,
        bufferEndPx: snapshot.bufferEndPx,
        bufferEmissionSeq: snapshot.bufferEmissionSeq,
        bufferMode: snapshot.bufferMode,
        rows: snapshot.rows,
        visibleRowCount: snapshot.visibleRowCount,
        firstId: snapshot.firstId,
        firstTopDeltaPx: snapshot.firstTopDeltaPx,
        lastId: snapshot.lastId,
        lastBottomDeltaPx: snapshot.lastBottomDeltaPx,
        blankTopGapPx: snapshot.blankTopGapPx,
      });
    }
    return snapshots;
  };
  const violations = [];
  const records = [];

  const recordViolations = (iteration, stage, snapshots) => {
    for (const snapshot of snapshots) {
      if (snapshot.blankTopGapPx > maxAllowedTopGapPx) {
        violations.push({
          iteration,
          stage,
          panel: snapshot.panel,
          code: "blank_top_gap",
          message: "Rendered rows start too far below the visible viewport.",
          snapshot,
        });
      }
      if (snapshot.rows > 0 && snapshot.visibleRowCount === 0) {
        violations.push({
          iteration,
          stage,
          panel: snapshot.panel,
          code: "no_visible_rows",
          message: "The viewport has buffered rows, but none intersect the visible area.",
          snapshot,
        });
      }
      if (
        snapshot.rows === 0 &&
        snapshot.bufferLayoutRowCount !== null &&
        snapshot.bufferLayoutRowCount > 0
      ) {
        violations.push({
          iteration,
          stage,
          panel: snapshot.panel,
          code: "empty_buffer_for_non_empty_layout",
          message: "Rust reported transcript rows but emitted an empty visible buffer.",
          snapshot,
        });
      }
	      const renderedBottomIsVisible =
	        snapshot.bufferEndIndex !== null &&
	        snapshot.bufferLayoutRowCount !== null &&
	        snapshot.bufferEndIndex >= snapshot.bufferLayoutRowCount &&
	        snapshot.lastBottomDeltaPx !== null &&
	        Math.abs(snapshot.lastBottomDeltaPx - snapshot.clientHeight) <= maxAllowedTopGapPx;
	      if (
	        stage === "bottom" &&
	        snapshot.maxTop - snapshot.scrollTop > ${MAX_ALLOWED_BOTTOM_DISTANCE_PX} &&
	        !renderedBottomIsVisible
	      ) {
        violations.push({
          iteration,
          stage,
          panel: snapshot.panel,
          code: "did_not_reach_bottom",
          message: "Fast-scroll-bottom did not settle near the bottom.",
          snapshot,
        });
      }
    }
  };

  const recordDownwardJitter = (iteration, previousByPanel, snapshots) => {
    for (const snapshot of snapshots) {
      const previous = previousByPanel.get(snapshot.panel);
      if (previous !== undefined && snapshot.scrollTop - previous > 120) {
        violations.push({
          iteration,
          stage: "settle",
          panel: snapshot.panel,
          code: "downward_jitter_after_fast_up",
          message: "Viewport moved downward again after the fast-scroll-up request.",
          snapshot,
        });
      }
      previousByPanel.set(snapshot.panel, snapshot.scrollTop);
    }
  };

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const logicalIteration = iterationOffset + iteration;
    const initial = publicSnapshots();
    recordViolations(logicalIteration, "initial", initial);

    for (const viewport of readViewports()) {
      viewport.el.scrollTop = viewport.maxTop;
      viewport.el.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    await sleep(bottomSettleMs);
    const bottom = publicSnapshots();
    recordViolations(logicalIteration, "bottom", bottom);

    for (const viewport of readViewports()) {
      viewport.el.scrollTop = 0;
      viewport.el.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
    const immediate = publicSnapshots();
    recordViolations(logicalIteration, "immediate", immediate);

    const previousByPanel = new Map(immediate.map((snapshot) => [snapshot.panel, snapshot.scrollTop]));
    const settleSamples = [];
    const settleStepMs = 100;
    const settleSteps = Math.max(1, Math.ceil(settleMs / settleStepMs));
    for (let step = 0; step < settleSteps; step += 1) {
      await sleep(settleStepMs);
      const sample = publicSnapshots();
      recordViolations(logicalIteration, "settle", sample);
      recordDownwardJitter(logicalIteration, previousByPanel, sample);
      for (const snapshot of sample) {
        settleSamples.push(snapshot);
      }
    }
    const after = publicSnapshots();
    recordViolations(logicalIteration, "after", after);
    records.push({ iteration: logicalIteration, initial, bottom, immediate, settleSamples, after });
  }

  const allSnapshots = [];
  for (const record of records) {
    for (const snapshot of record.initial) {
      allSnapshots.push(snapshot);
    }
    for (const snapshot of record.bottom) {
      allSnapshots.push(snapshot);
    }
    for (const snapshot of record.immediate) {
      allSnapshots.push(snapshot);
    }
    for (const snapshot of record.settleSamples) {
      allSnapshots.push(snapshot);
    }
    for (const snapshot of record.after) {
      allSnapshots.push(snapshot);
    }
  }
  let maxBlankTopGapPx = 0;
  for (const snapshot of allSnapshots) {
    maxBlankTopGapPx = Math.max(maxBlankTopGapPx, snapshot.blankTopGapPx);
  }
  let maxSettleScrollTopPx = 0;
  for (const record of records) {
    for (const snapshot of record.after) {
      maxSettleScrollTopPx = Math.max(maxSettleScrollTopPx, snapshot.scrollTop);
    }
  }

  return {
    ok: violations.length === 0,
    iterations,
    viewportCount: readViewports().length,
    maxBlankTopGapPx,
    maxSettleScrollTopPx,
    violations,
    records,
  };
})()
`;
}

function writeArtifact(result: ScenarioResult): string {
	const artifactPath = join(
		"/tmp",
		`acepe-transcript-viewport-scroll-qa-${Date.now().toString()}.json`
	);
	writeFileSync(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
	return artifactPath;
}

function printSummary(
	result: ScenarioResult,
	artifactPath: string,
	minViewports: number
): void {
	console.log(`Transcript viewport fast-scroll QA`);
	console.log(`- iterations: ${result.iterations}`);
	console.log(`- viewports: ${result.viewportCount}`);
	console.log(`- max blank top gap px: ${result.maxBlankTopGapPx}`);
	console.log(`- max settled scrollTop px: ${result.maxSettleScrollTopPx}`);
	console.log(`- artifact: ${artifactPath}`);
	if (result.violations.length > 0) {
		console.error(`- violations: ${result.violations.length}`);
		for (const violation of result.violations.slice(0, 8)) {
			console.error(
				`  ${violation.stage} iteration=${violation.iteration} panel=${violation.panel} ${violation.code}: ${violation.message}`
			);
			console.error(`  snapshot=${JSON.stringify(violation.snapshot)}`);
		}
	}
	if (result.viewportCount < minViewports) {
		console.error(
			`- environment: expected ${minViewports} visible scrollable transcript viewport(s)`
		);
	}
}

async function main(): Promise<number> {
	const appIdentifier = stringArg("--app", DEFAULT_APP_IDENTIFIER);
	const iterations = numberArg("--iterations", DEFAULT_ITERATIONS);
	const bottomSettleMs = numberArg("--bottom-settle-ms", DEFAULT_BOTTOM_SETTLE_MS);
	const settleMs = numberArg("--settle-ms", DEFAULT_SETTLE_MS);
	const callTimeoutMs = numberArg("--call-timeout-ms", DEFAULT_CALL_TIMEOUT_MS);
	const minViewports = numberArg("--min-viewports", DEFAULT_MIN_VIEWPORTS);
	const skipDriver = boolArg("--skip-driver");

	if (!existsSync(join(process.cwd(), "src-tauri"))) {
		console.error("Run this command from packages/desktop.");
		return 1;
	}

	if (!skipDriver) {
		await runTauri(["driver-session", "start", "--port", appIdentifier]);
	}

	const records: ScenarioResult["records"] = [];
	const violations: ScenarioResult["violations"] = [];
	let viewportCount = 0;
	let maxBlankTopGapPx = 0;
	let maxSettleScrollTopPx = 0;

	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const execution = await runTauri([
			"webview-execute-js",
			"--app-identifier",
			appIdentifier,
			"--json",
			"--call-timeout",
			callTimeoutMs.toString(),
			"--script",
			scenarioScript({
				iterations: 1,
				iterationOffset: iteration,
				bottomSettleMs,
				settleMs,
				maxAllowedTopGapPx: MAX_ALLOWED_TOP_GAP_PX,
			}),
		]);
		if (execution.code !== 0) {
			console.error(execution.stderr.trim() || execution.stdout.trim());
			return execution.code;
		}

		const payload = unwrapTauriText(execution.stdout);
		const resultJson = jsonObjectPrefix(payload);
		if (resultJson === null) {
			const artifactPath = join(
				"/tmp",
				`acepe-transcript-viewport-scroll-qa-raw-${Date.now().toString()}.txt`
			);
			writeFileSync(artifactPath, payload);
			console.error("Tauri MCP did not return a JSON result.");
			console.error(`- raw artifact: ${artifactPath}`);
			console.error(payload.slice(0, 800));
			return 1;
		}
		const iterationResult = scenarioSchema.parse(JSON.parse(resultJson));
		viewportCount = iterationResult.viewportCount;
		maxBlankTopGapPx = Math.max(maxBlankTopGapPx, iterationResult.maxBlankTopGapPx);
		maxSettleScrollTopPx = Math.max(
			maxSettleScrollTopPx,
			iterationResult.maxSettleScrollTopPx
		);
		for (const record of iterationResult.records) {
			records.push(record);
		}
		for (const violation of iterationResult.violations) {
			violations.push(violation);
		}
	}

	const result: ScenarioResult = {
		ok: violations.length === 0 && viewportCount >= minViewports,
		iterations,
		viewportCount,
		maxBlankTopGapPx,
		maxSettleScrollTopPx,
		violations,
		records,
	};
	const artifactPath = writeArtifact(result);
	printSummary(result, artifactPath, minViewports);
	return result.ok ? 0 : 1;
}

const exitCode = await main();
process.exit(exitCode);
