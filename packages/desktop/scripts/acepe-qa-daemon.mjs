#!/usr/bin/env node

import { createServer } from "node:net";
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

async function ensureSession(appIdentifier) {
	const port = Number.parseInt(String(appIdentifier), 10);
	const startResult = await sessionManager.manageDriverSession(
		"start",
		undefined,
		Number.isFinite(port) ? port : undefined,
		undefined
	);
	return startResult;
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
