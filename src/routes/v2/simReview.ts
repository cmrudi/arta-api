import { Router } from 'express';

import { getAdminReviews, getSimReviews, postSimReview } from '../../controllers/v2/simReviewController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';
import { requireAuth0Role } from '../../middlewares/auth0RoleAuth';
import { REFUND_REVIEWER_ROLE } from '../../models/refund';

const simReviewRouter = Router();

// Deliberately unauthenticated, matching /v1/esims/id/{SimId}, which is also
// auth=NONE. The SimId is already the bearer capability for a SIM: anyone
// holding it can read the eSIM's full detail including its activation code.
// Requiring a token here would only have blocked the person an eSIM was shared
// with — who is usually the one actually travelling on it, and so the one whose
// answer is worth having.
simReviewRouter.get('/sim/:SimId/review', getSimReviews);
simReviewRouter.post('/sim/:SimId/review', postSimReview);

// Admin: the whole review list, for the arta-admin Customer Reviews page. Same
// gate as the refund queue - customers' emails and comments are in here.
simReviewRouter.get('/admin/reviews', requireAuth0Bearer, requireAuth0Role(REFUND_REVIEWER_ROLE), getAdminReviews);

export default simReviewRouter;
