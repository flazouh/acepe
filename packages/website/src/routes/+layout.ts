import type { LayoutLoad } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { browser } from '$app/environment';
import { env } from '$env/dynamic/public';

export const load: LayoutLoad = async ({ data }) => {
	const dsn = env.PUBLIC_SENTRY_DSN;
	if (browser && dsn) {
		Sentry.init({
			dsn,
			environment: import.meta.env.MODE,
			integrations: [
				Sentry.browserTracingIntegration(),
				Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false })
			],
			tracesSampleRate: 0.1,
			replaysSessionSampleRate: 0.1,
			replaysOnErrorSampleRate: 1.0
		});
	}

	return data;
};
