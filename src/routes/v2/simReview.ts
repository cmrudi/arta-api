import { Router } from 'express';

import { getSimReviews, postSimReview } from '../../controllers/v2/simReviewController';

const simReviewRouter = Router();

// Deliberately unauthenticated, matching /v1/esims/id/{SimId}, which is also
// auth=NONE. The SimId is already the bearer capability for a SIM: anyone
// holding it can read the eSIM's full detail including its activation code.
// Requiring a token here would only have blocked the person an eSIM was shared
// with — who is usually the one actually travelling on it, and so the one whose
// answer is worth having.
simReviewRouter.get('/sim/:SimId/review', getSimReviews);
simReviewRouter.post('/sim/:SimId/review', postSimReview);

export default simReviewRouter;
