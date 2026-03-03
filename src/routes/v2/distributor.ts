import { Router } from 'express';

import {
	getDistributorPackageList,
	getDistributorWalletBalance,
} from '../../controllers/v2/distributorController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';

const distributorRouter = Router();

distributorRouter.get('/dist/package/list', getDistributorPackageList);
distributorRouter.get('/dist/wallet/balance', requireAuth0Bearer, getDistributorWalletBalance);

export default distributorRouter;
