import { WaitlistRepositoryImpl } from './repositories/WaitlistRepositoryImpl';
import { ResendEmailService } from './email/ResendEmailService';
import { WaitlistApplicationService } from '../application/WaitlistApplicationService';
import { ReportRepositoryImpl } from './repositories/ReportRepositoryImpl';
import { CommentRepositoryImpl } from './repositories/CommentRepositoryImpl';
import { VoteRepositoryImpl } from './repositories/VoteRepositoryImpl';
import { FollowerRepositoryImpl } from './repositories/FollowerRepositoryImpl';
import { ReportsApplicationService } from '../application/ReportsApplicationService';

let waitlistService: WaitlistApplicationService | undefined;
let reportsService: ReportsApplicationService | undefined;

export const container = {
	getWaitlistService(): WaitlistApplicationService {
		if (!waitlistService) {
			const repository = new WaitlistRepositoryImpl();
			const emailService = new ResendEmailService();
			waitlistService = new WaitlistApplicationService(repository, emailService);
		}
		return waitlistService;
	},

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
