import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const showcaseSource = readFileSync(
	fileURLToPath(new URL('./main-app-showcase.svelte', import.meta.url)),
	'utf8'
);

const demoWrapperSource = readFileSync(
	fileURLToPath(new URL('./main-app-view-demo.svelte', import.meta.url)),
	'utf8'
);

describe('MainAppShowcase', () => {
	it('keeps the website showcase wired to the shared desktop shell components', () => {
		expect(showcaseSource).toContain('AppMainLayout');
		expect(showcaseSource).toContain('AppTopBar');
		expect(showcaseSource).toContain('AppTabBarGrouped');
		expect(showcaseSource).toContain('AppTabBarTab');
		expect(showcaseSource).toContain('SectionedFeed');
		expect(showcaseSource).toContain('AppSidebarProjectGroup');
		expect(showcaseSource).toContain('ProjectCard');
		expect(showcaseSource).toContain('AgentPanelLayout');
		expect(showcaseSource).not.toContain('$effect');
		expect(showcaseSource).not.toContain('↺ Replay');
	});

	it('leaves the legacy demo file as a thin wrapper around MainAppShowcase', () => {
		expect(demoWrapperSource).toContain("import MainAppShowcase from './main-app-showcase.svelte';");
		expect(demoWrapperSource).toContain('<MainAppShowcase />');
	});
});
