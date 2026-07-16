#!/usr/bin/env node

import { createServer } from "node:net";
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDriverSession } from "./acepe-qa/driver-session.ts";

const socketPath = process.argv[2];
const readyPath = process.argv[3];

function jsonLine(payload) {
	return `${JSON.stringify(payload)}\n`;
}

function findPackageRoot(packageName) {
	const explicit = process.env.TAURI_MCP_SERVER_DIR;
	if (explicit && existsSync(join(explicit, "package.json"))) {
		return explicit;
	}

	const npxRoot = join(homedir(), ".npm", "_npx");
	const candidates = [];
	if (existsSync(npxRoot)) {
		for (const entry of readdirSync(npxRoot)) {
			const root = join(npxRoot, entry, "node_modules", packageName);
			if (existsSync(join(root, "package.json"))) {
				candidates.push(root);
			}
		}
	}
	if (candidates.length === 0) {
		throw new Error(`Unable to locate ${packageName}. Run one normal qa command to warm npx.`);
	}
	candidates.sort((left, right) => statSync(join(right, "package.json")).mtimeMs - statSync(join(left, "package.json")).mtimeMs);
	return candidates[0];
}

const packageRoot = findPackageRoot("@hypothesi/tauri-mcp-server");
const sessionManager = await import(pathToFileURL(join(packageRoot, "dist", "driver", "session-manager.js")).href);
const webviewExecutor = await import(pathToFileURL(join(packageRoot, "dist", "driver", "webview-executor.js")).href);
let webviewRunCounter = 0;

function withTimeout(promise, timeoutMs, label) {
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			setTimeout(() => {
				reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
			}, timeoutMs);
		}),
	]);
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function contextResultText(result) {
	return typeof result.result === "string" ? result.result : JSON.stringify(result.result);
}

function contextResultJson(result) {
	return JSON.parse(contextResultText(result));
}

async function ensureSession(appIdentifier) {
	const startResult = await withTimeout(
		ensureDriverSession(sessionManager, String(appIdentifier)),
		12000,
		"Tauri MCP driver session"
	);
	return startResult;
}

async function executeWebviewScript(appIdentifier, script, timeoutMs) {
	webviewRunCounter += 1;
	const runId = `acepe-qa-${Date.now()}-${webviewRunCounter}`;
	const kickoffScript = `
(() => {
  const runId = ${JSON.stringify(runId)};
  const expression = ${JSON.stringify(script)};
  const results = window.__acepeQaAsyncResults || {};
  window.__acepeQaAsyncResults = results;
  results[runId] = { status: "pending", value: null, message: null };
  Promise.resolve()
    .then(() => Function("return (" + expression + ")")())
    .then((value) => {
      results[runId] = { status: "done", value, message: null };
    }, (error) => {
      const message = error && typeof error.message === "string" ? error.message : String(error);
      results[runId] = { status: "error", value: null, message };
    });
  return { status: "started", runId };
})()
`;
	contextResultJson(
		await webviewExecutor.executeInWebviewWithContext(
			kickoffScript,
			undefined,
			appIdentifier
		)
	);
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		await sleep(50);
		const status = contextResultJson(
			await webviewExecutor.executeInWebviewWithContext(
				`
(() => {
  const runId = ${JSON.stringify(runId)};
  const results = window.__acepeQaAsyncResults || {};
  return results[runId] || { status: "missing", value: null, message: "QA async result missing." };
})()
`,
				undefined,
				appIdentifier
			)
		);
		if (status.status === "done") {
			webviewExecutor.executeInWebviewWithContext(
				`
(() => {
  const results = window.__acepeQaAsyncResults || {};
  delete results[${JSON.stringify(runId)}];
  return true;
})()
`,
				undefined,
				appIdentifier
			).catch(() => undefined);
			return status.value;
		}
		if (status.status === "error" || status.status === "missing") {
			throw new Error(status.message || "Tauri MCP WebView JS execution failed.");
		}
	}
	throw new Error(`Tauri MCP WebView JS execution timed out after ${timeoutMs}ms.`);
}

async function handleRequest(request) {
	if (request.kind === "ping") {
		return { ok: true, ready: true };
	}

	if (request.kind === "driver-session-start") {
		const result = await ensureSession(request.appIdentifier);
		return { ok: true, stdout: result, stderr: "", code: 0 };
	}

	if (request.kind === "webview-execute-js") {
		await ensureSession(request.appIdentifier);
		const timeoutMs = Number.isFinite(request.callTimeoutMs) ? request.callTimeoutMs : 15000;
		const result = await withTimeout(
			executeWebviewScript(request.appIdentifier, request.script, timeoutMs),
			timeoutMs + 2000,
			"Tauri MCP WebView JS execution"
		);
		const resultText =
			typeof result === "string" ? result : JSON.stringify(result);
		return {
			ok: true,
			text: `${resultText}\n\n[Executed in window: main]`,
		};
	}

	if (request.kind === "webview-execute-js-sync") {
		await ensureSession(request.appIdentifier);
		const result = await webviewExecutor.executeInWebviewWithContext(
			request.script,
			undefined,
			request.appIdentifier
		);
		const resultText =
			typeof result.result === "string" ? result.result : JSON.stringify(result.result);
		return {
			ok: true,
			text: `${resultText}\n\n[Executed in window: ${result.windowLabel}]`,
		};
	}

	if (request.kind === "webview-screenshot") {
		await ensureSession(request.appIdentifier);
		const screenshot = await webviewExecutor.captureScreenshot({
			format: "jpeg",
			quality: 80,
			appIdentifier: request.appIdentifier,
		});
		const image = screenshot.content.find((item) => item.type === "image");
		if (image?.data) {
			const extension = image.mimeType === "image/png" ? "png" : "jpg";
			const path = join(tmpdir(), `acepe-qa-screenshot-${Date.now()}.${extension}`);
			writeFileSync(path, Buffer.from(image.data, "base64"));
			return {
				ok: true,
				files: [{ path, mimeType: image.mimeType ?? "image/jpeg" }],
				content: [{ type: "image", path, mimeType: image.mimeType ?? "image/jpeg" }],
				text: "Screenshot captured",
			};
		}
		return {
			ok: true,
			files: [],
			content: image ? [image] : screenshot.content,
			text: "Screenshot captured",
		};
	}

	return { ok: false, code: "unknown_request", message: request.kind };
}

if (existsSync(socketPath)) {
	rmSync(socketPath, { force: true });
}

const server = createServer((socket) => {
	let buffer = "";
	socket.on("data", (chunk) => {
		buffer += chunk.toString("utf8");
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = buffer.slice(0, newlineIndex);
			buffer = buffer.slice(newlineIndex + 1);
			Promise.resolve()
				.then(() => handleRequest(JSON.parse(line)))
				.then((response) => {
					socket.write(jsonLine(response));
				})
				.catch((error) => {
					socket.write(jsonLine({
						ok: false,
						code: "daemon_request_failed",
						message: error instanceof Error ? error.message : String(error),
					}));
				});
			newlineIndex = buffer.indexOf("\n");
		}
	});
});

server.listen(socketPath, () => {
	writeFileSync(readyPath, jsonLine({ ready: true, socketPath }));
});
