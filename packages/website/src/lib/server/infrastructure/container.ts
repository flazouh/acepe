import { ReportRepositoryImpl } from './repositories/ReportRepositoryImpl';
import { CommentRepositoryImpl } from './repositories/CommentRepositoryImpl';
import { VoteRepositoryImpl } from './repositories/VoteRepositoryImpl';
import { FollowerRepositoryImpl } from './repositories/FollowerRepositoryImpl';
import { ReportsApplicationService } from '../application/ReportsApplicationService';

let reportsService: ReportsApplicationService | undefined;

export const container = {
	getReportsService(): ReportsApplicationService {
		if (!reportsService) {
			reportsService = new ReportsApplicationService(
				new ReportRepositoryImpl(),
				new CommentRepositoryImpl(),
				new VoteRepositoryImpl(),
				new FollowerRepositoryImpl()
			);
		}
		return reportsService;
	}
};
