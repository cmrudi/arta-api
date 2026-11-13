import { Router } from 'express';

import {
  getAdminPartnerWallet,
  getAdminPayoutBalance,
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
  getWithdrawalChannels,
  postCheckWithdrawalAccount,
  postSendPartnerWithdrawalPayout,
  postXenithPayWebhook,
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
// Where the money can go (XenithPay banks + e-wallets) and who owns an account.
partnerPayoutRouter.get('/partner/payout-channels', requireAuth0EndUser, getWithdrawalChannels);
partnerPayoutRouter.post('/partner/payout-accounts/check', requireAuth0EndUser, postCheckWithdrawalAccount);
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
// XenithPay account balance - what approved payouts are paid from.
partnerPayoutRouter.get('/admin/payout-balance', requireFinance, getAdminPayoutBalance);
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
// Approve sends the payout through XenithPay; this retries one that could not be sent.
partnerPayoutRouter.post(
  '/admin/partner-withdrawals/:withdrawalId/send-payout',
  requireFinance,
  postSendPartnerWithdrawalPayout,
);

// XenithPay payout status callbacks (verified by signature, no login).
partnerPayoutRouter.post('/webhooks/xenithpay', postXenithPayWebhook);

export default partnerPayoutRouter;
