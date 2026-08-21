import { Router } from 'express';

import { validatePromotion } from '../../controllers/v2/promotionController';
import { requireAuth0EndUser } from '../../middlewares/auth0EndUserAuth';

const promotionRouter = Router();

// End-user route: authorized with the browser's Auth0 ID token, not an
// API-audience machine token. The email it carries is what per-user promo
// rules are keyed on, so this must stay authenticated.
promotionRouter.get(
  '/promo/validate/:productCode/:promoCode',
  requireAuth0EndUser,
  validatePromotion,
);

export default promotionRouter;
