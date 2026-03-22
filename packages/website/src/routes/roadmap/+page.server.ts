import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { container } from '$lib/server/infrastructure/container';
import { optionalAuth, toRoadmapCardOutput } from '../api/reports/_helpers';

const ROADMAP_STATUSES = ['open', 'planned', 'in_progress', 'completed'] as const;
type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export const load: PageServerLoad = async ({ parent, cookies }) => {
	const { featureFlags } = await parent();

	if (!featureFlags.roadmapEnabled) {
		throw redirect(302, '/');
	}

	const service = container.getReportsService();
	const user = await optionalAuth(cookies);
	const userId = user ? user.id : null;

	const columnEntries = await Promise.all(
		ROADMAP_STATUSES.map(async (status: RoadmapStatus) => {
			const listResult = await service.listReports(
				{ status, category: 'feature_request' },
				'votes',
				1,
				50
			);

			if (listResult.isErr()) {
				return [status, { items: [], totalCount: 0 }] as const;
			}

			const enrichResult = await service
				.enrichReportsWithUserData(listResult.value.items, userId)
				.map((enriched) => ({
					items: enriched.map(toRoadmapCardOutput),
					totalCount: listResult.value.totalCount
				}));

			if (enrichResult.isErr()) {
				return [status, { items: [], totalCount: 0 }] as const;
			}

			return [status, enrichResult.value] as const;
		})
	);

	const columns = Object.fromEntries(columnEntries) as Record<
		RoadmapStatus,
		{ items: ReturnType<typeof toRoadmapCardOutput>[]; totalCount: number }
	>;

	return {
		columns,
		userId
	};
};
