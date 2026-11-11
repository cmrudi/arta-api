import { Router } from 'express';

import {
  getAdminPartner,
  getAdminPartners,
  getMyPartner,
  getMyPartnerOrders,
  getPartnerKeyExists,
  patchAdminPartner,
  postAdminPartnerKey,
  postRegisterPartner,
} from '../../controllers/v2/partnerController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';
import { requireAuth0EndUser } from '../../middlewares/auth0EndUserAuth';
import { requireAuth0Role } from '../../middlewares/auth0RoleAuth';
import { PARTNER_PAYOUT_ROLE } from '../../models/partnerPayout';

const partnerRouter = Router();

// Public: the registration form checks a key while the user types.
partnerRouter.get('/partner/keys/:key/exists', getPartnerKeyExists);

// Partner portal: the logged-in partner's own token. The account is the one for
// the token's email; the request body never names an email or partnerId.
partnerRouter.post('/partner/register', requireAuth0EndUser, postRegisterPartner);
partnerRouter.get('/partner/me', requireAuth0EndUser, getMyPartner);
partnerRouter.get('/partner/me/orders', requireAuth0EndUser, getMyPartnerOrders);

// Finance (same role as payouts): look partners up, change a login email or
// name, add a key. The partnerId never changes.
const requireFinance = [requireAuth0Bearer, requireAuth0Role(PARTNER_PAYOUT_ROLE)];

partnerRouter.get('/admin/partners', requireFinance, getAdminPartners);
partnerRouter.get('/admin/partners/:partnerId', requireFinance, getAdminPartner);
partnerRouter.patch('/admin/partners/:partnerId', requireFinance, patchAdminPartner);
partnerRouter.post('/admin/partners/:partnerId/keys', requireFinance, postAdminPartnerKey);

export default partnerRouter;
