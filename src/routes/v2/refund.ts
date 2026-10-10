import { Router } from 'express';

import {
  getAdminRefund,
  getAdminRefunds,
  getSimRefund,
  postApproveRefund,
  postCompleteRefund,
  postRejectRefund,
  postRetryRefund,
  postSimRefund,
} from '../../controllers/v2/refundController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';
import { requireAuth0EndUser } from '../../middlewares/auth0EndUserAuth';
import { requireAuth0Role } from '../../middlewares/auth0RoleAuth';
import { REFUND_REVIEWER_ROLE } from '../../models/refund';

const refundRouter = Router();

// Customer: the buyer's browser ID token. Unlike the review routes, holding a
// SimId is not enough here - a refund cancels the eSIM, so only the person who
// paid may ask for it.
refundRouter.get('/sim/:SimId/refund', requireAuth0EndUser, getSimRefund);
refundRouter.post('/sim/:SimId/refund', requireAuth0EndUser, postSimRefund);

// Admin: an API access token from arta-admin whose user has the reviewer role.
const requireReviewer = [requireAuth0Bearer, requireAuth0Role(REFUND_REVIEWER_ROLE)];

refundRouter.get('/admin/refunds', requireReviewer, getAdminRefunds);
refundRouter.get('/admin/refunds/:refundId', requireReviewer, getAdminRefund);
refundRouter.post('/admin/refunds/:refundId/approve', requireReviewer, postApproveRefund);
refundRouter.post('/admin/refunds/:refundId/reject', requireReviewer, postRejectRefund);
refundRouter.post('/admin/refunds/:refundId/retry', requireReviewer, postRetryRefund);
refundRouter.post('/admin/refunds/:refundId/complete', requireReviewer, postCompleteRefund);

export default refundRouter;
