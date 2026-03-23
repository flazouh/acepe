/**
 * Website analytics and error tracking via Sentry.
 * Note: Enum kept local here because Railway builds from packages/website
 * and cannot resolve workspace siblings; sync with packages/analytics when adding events.
 */

import * as Sentry from '@sentry/sveltekit';

export enum AnalyticsEvent {
	Downloaded = 'downloaded'
}

export function capture(event: AnalyticsEvent, properties?: Record<string, unknown>): void {
	Sentry.captureMessage(event, {
		level: 'info',
		extra: { ...properties, source: 'website' }
	});
}
