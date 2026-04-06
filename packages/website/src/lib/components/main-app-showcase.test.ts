import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const showcaseSource = readFileSync(
	'/home/runner/work/acepe/acepe/packages/website/src/lib/components/main-app-showcase.svelte',
	'utf8'
);

const demoWrapperSource = readFileSync(
	'/home/runner/work/acepe/acepe/packages/website/src/lib/components/main-app-view-demo.svelte',
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
