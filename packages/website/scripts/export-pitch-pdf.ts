import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Browser } from 'playwright';
import { chromium } from 'playwright';

const WEBSITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_OUTPUT_PATH = resolve(WEBSITE_ROOT, 'artifacts/acepe-investor-pitch.pdf');
const DEFAULT_PORT = 4173;
const PITCH_SECTION_COUNT = 10;
const PITCH_PDF_WIDTH = '13.333in';
const PITCH_PDF_HEIGHT = '7.5in';
const READINESS_SELECTOR = 'data-pitch-root';
const READINESS_ATTEMPTS = 60;
const READINESS_DELAY_MS = 250;

export interface ExportPitchPdfOptions {
	readonly baseUrl: string | null;
	readonly outputPath: string;
	readonly port: number;
}

export function parseExportPitchPdfArgs(
	argv: readonly string[],
	defaultOutputPath = DEFAULT_OUTPUT_PATH
): ExportPitchPdfOptions {
	let baseUrl: string | null = null;
	let outputPath = defaultOutputPath;
	let port = DEFAULT_PORT;

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		const nextValue = argv[index + 1];

		if ((argument === '--base-url' || argument === '--output' || argument === '--port') && !nextValue) {
			throw new Error(`Missing value for ${argument}`);
		}

		if (argument === '--base-url') {
			baseUrl = nextValue;
			index += 1;
		} else if (argument === '--output') {
			outputPath = resolve(WEBSITE_ROOT, nextValue);
			index += 1;
		} else if (argument === '--port') {
			port = Number.parseInt(nextValue, 10);
			index += 1;
		}
	}

	if (!Number.isFinite(port) || port <= 0) {
		throw new Error('Port must be a positive integer');
	}

	return {
		baseUrl,
		outputPath,
		port,
	};
}

export function createPreviewBaseUrl(port: number): string {
	return `http://127.0.0.1:${port}`;
}

export function createPitchUrl(baseUrl: string): string {
	return new URL('/pitch', `${baseUrl.replace(/\/$/, '')}/`).toString();
}

export function createPreviewArgs(port: number): readonly string[] {
	return ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(port)];
}

export function countPdfPages(pdfContents: string): number {
	const matches = pdfContents.match(/\/Type\s*\/Page\b/g);
	return matches ? matches.length : 0;
}

async function sleep(delayMs: number): Promise<void> {
	await new Promise<void>((resolvePromise) => {
		setTimeout(resolvePromise, delayMs);
	});
}

export async function waitForPitchReady(
	pitchUrl: string,
	fetchFn: typeof fetch = fetch,
	maxAttempts = READINESS_ATTEMPTS,
	delayMs = READINESS_DELAY_MS
): Promise<void> {
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const response = await fetchFn(pitchUrl).then(
			(fetchResponse) => fetchResponse,
			() => null
		);

		if (response?.ok) {
			const body = await response.text();

			if (body.includes(READINESS_SELECTOR)) {
				return;
			}
		}

		if (attempt < maxAttempts - 1) {
			await sleep(delayMs);
		}
	}

	throw new Error(`Pitch route never became ready at ${pitchUrl}`);
}

async function runCommand(command: string, args: readonly string[]): Promise<void> {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(command, Array.from(args), {
			cwd: WEBSITE_ROOT,
			stdio: 'inherit',
		});

		child.on('error', rejectPromise);
		child.on('exit', (exitCode) => {
			if (exitCode === 0) {
				resolvePromise();
				return;
			}

			rejectPromise(new Error(`${command} ${args.join(' ')} failed with exit code ${exitCode ?? 'unknown'}`));
		});
	});
}

function startPreview(port: number): ChildProcess {
	return spawn('bun', Array.from(createPreviewArgs(port)), {
		cwd: WEBSITE_ROOT,
		env: Object.assign({}, process.env, { ACEPE_PITCH_EXPORT: '1' }),
		stdio: 'inherit',
	});
}

async function stopPreview(previewProcess: ChildProcess): Promise<void> {
	if (previewProcess.exitCode !== null) {
		return;
	}

	await new Promise<void>((resolvePromise) => {
		previewProcess.once('exit', () => resolvePromise());
		previewProcess.kill('SIGTERM');
	});
}

async function getOverflowSectionIds(browser: Browser, pitchUrl: string): Promise<readonly string[]> {
	const page = await browser.newPage({
		viewport: {
			width: 1600,
			height: 900,
		},
	});

	await page.goto(pitchUrl, { waitUntil: 'networkidle' });
	await page.waitForSelector('[data-pitch-root]');

	const overflowSectionIds = await page.locator('[data-pitch-slide]').evaluateAll((elements) => {
		return elements.flatMap((element) => {
			if (element.scrollHeight <= element.clientHeight + 1) {
				return [];
			}

			const id = element.getAttribute('id');
			return [id ?? 'unknown'];
		});
	});

	await page.close();
	return overflowSectionIds;
}

async function launchExportBrowser(): Promise<Browser> {
	return chromium.launch().then(
		(browser) => browser,
		(error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);

			if (!message.includes("Executable doesn't exist")) {
				throw error;
			}

			return chromium.launch({ channel: 'chrome' });
		}
	);
}

export async function exportPitchPdf(options: ExportPitchPdfOptions): Promise<{
	readonly outputPath: string;
	readonly pitchUrl: string;
	readonly pageCount: number;
}> {
	let previewProcess: ChildProcess | null = null;
	let browser: Browser | null = null;
	const baseUrl = options.baseUrl ?? createPreviewBaseUrl(options.port);
	const pitchUrl = createPitchUrl(baseUrl);

	try {
		if (options.baseUrl === null) {
			await runCommand('bun', ['run', 'build']);
			previewProcess = startPreview(options.port);
		}

		await waitForPitchReady(pitchUrl);
		browser = await launchExportBrowser();

		const overflowSectionIds = await getOverflowSectionIds(browser, pitchUrl);

		if (overflowSectionIds.length > 0) {
			throw new Error(`Pitch export failed: slide overflow detected in ${overflowSectionIds.join(', ')}`);
		}

		const page = await browser.newPage({
			viewport: {
				width: 1600,
				height: 900,
			},
		});

		await page.goto(pitchUrl, { waitUntil: 'networkidle' });
		await page.waitForSelector('[data-pitch-root]');

		const sectionCount = await page.locator('[data-pitch-section]').count();

		if (sectionCount !== PITCH_SECTION_COUNT) {
			throw new Error(`Expected ${PITCH_SECTION_COUNT} pitch sections, found ${sectionCount}`);
		}

		await mkdir(dirname(options.outputPath), { recursive: true });
		await page.pdf({
			path: options.outputPath,
			width: PITCH_PDF_WIDTH,
			height: PITCH_PDF_HEIGHT,
			printBackground: true,
		});
		await page.close();

		const pdfContents = await readFile(options.outputPath, 'latin1');
		const pageCount = countPdfPages(pdfContents);

		if (pageCount !== sectionCount) {
			throw new Error(`Expected ${sectionCount} PDF pages, found ${pageCount}`);
		}

		return {
			outputPath: options.outputPath,
			pitchUrl,
			pageCount,
		};
	} finally {
		if (browser) {
			await browser.close();
		}

		if (previewProcess) {
			await stopPreview(previewProcess);
		}
	}
}

if (import.meta.main) {
	const options = parseExportPitchPdfArgs(process.argv.slice(2));

	exportPitchPdf(options).then(
		(result) => {
			console.log(`Exported ${result.pageCount} pitch PDF pages to ${result.outputPath}`);
		},
		(error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			console.error(message);
			process.exit(1);
		}
	);
}
