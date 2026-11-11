import { Router } from 'express';

import {
  getAdminPartnerWallet,
  getAdminPartnerWallets,
  getAdminPartnerWithdrawal,
  getAdminPartnerWithdrawals,
  getMyPartnerWallet,
  postAdminPartnerAdjustment,
  postApprovePartnerWithdrawal,
  postCancelMyPartnerWithdrawal,
  postMyPartnerWithdrawal,
  postPayPartnerWithdrawal,
  postRejectPartnerWithdrawal,
} from '../../controllers/v2/partnerPayoutController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';
import { requireAuth0EndUser } from '../../middlewares/auth0EndUserAuth';
import { requireAuth0Role } from '../../middlewares/auth0RoleAuth';
import { PARTNER_PAYOUT_ROLE } from '../../models/partnerPayout';

const partnerPayoutRouter = Router();

// Partner portal: the logged-in partner's own token. The wallet is found through
// the email on that token (email -> partnerId), never from anything the client sends.
partnerPayoutRouter.get('/partner/wallet', requireAuth0EndUser, getMyPartnerWallet);
partnerPayoutRouter.post('/partner/withdrawals', requireAuth0EndUser, postMyPartnerWithdrawal);
partnerPayoutRouter.post(
  '/partner/withdrawals/:withdrawalId/cancel',
  requireAuth0EndUser,
  postCancelMyPartnerWithdrawal,
);

// Finance: an arta-admin access token whose user has the finance role.
const requireFinance = [requireAuth0Bearer, requireAuth0Role(PARTNER_PAYOUT_ROLE)];

partnerPayoutRouter.get('/admin/partner-wallets', requireFinance, getAdminPartnerWallets);
partnerPayoutRouter.get('/admin/partner-wallets/:partnerId', requireFinance, getAdminPartnerWallet);
partnerPayoutRouter.post('/admin/partner-wallets/adjustments', requireFinance, postAdminPartnerAdjustment);
partnerPayoutRouter.get('/admin/partner-withdrawals', requireFinance, getAdminPartnerWithdrawals);
partnerPayoutRouter.get('/admin/partner-withdrawals/:withdrawalId', requireFinance, getAdminPartnerWithdrawal);
partnerPayoutRouter.post(
  '/admin/partner-withdrawals/:withdrawalId/approve',
  requireFinance,
  postApprovePartnerWithdrawal,
);
partnerPayoutRouter.post(
  '/admin/partner-withdrawals/:withdrawalId/reject',
  requireFinance,
  postRejectPartnerWithdrawal,
);
partnerPayoutRouter.post('/admin/partner-withdrawals/:withdrawalId/pay', requireFinance, postPayPartnerWithdrawal);

export default partnerPayoutRouter;
