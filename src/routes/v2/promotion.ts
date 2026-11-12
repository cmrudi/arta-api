import { Router } from 'express';

import {
  getAdminPromoCodes,
  postAdminPromoCode,
  postDisableAdminPromoCode,
  postEnableAdminPromoCode,
  validatePromotion,
} from '../../controllers/v2/promotionController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';
import { requireAuth0EndUser } from '../../middlewares/auth0EndUserAuth';
import { requireAnyAuth0Role } from '../../middlewares/auth0RoleAuth';
import { PROMO_ADMIN_ROLES } from '../../models/promoCode';

const promotionRouter = Router();

// End-user route: authorized with the browser's Auth0 ID token, not an
// API-audience machine token. The email it carries is what per-user promo
// rules are keyed on, so this must stay authenticated.
promotionRouter.get(
  '/promo/validate/:productCode/:promoCode',
  requireAuth0EndUser,
  validatePromotion,
);

// Admin: an arta-admin access token whose user has a promo admin role.
const requirePromoAdmin = [requireAuth0Bearer, requireAnyAuth0Role(PROMO_ADMIN_ROLES)];

promotionRouter.get('/admin/promo-codes', requirePromoAdmin, getAdminPromoCodes);
promotionRouter.post('/admin/promo-codes', requirePromoAdmin, postAdminPromoCode);
promotionRouter.post('/admin/promo-codes/:code/enable', requirePromoAdmin, postEnableAdminPromoCode);
promotionRouter.post('/admin/promo-codes/:code/disable', requirePromoAdmin, postDisableAdminPromoCode);

export default promotionRouter;
