import { Router } from 'express';

import {
	createDistOrder,
	getDistributorPackageList,
	getDistributorWalletBalance,
} from '../../controllers/v2/distributorController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';

const distributorRouter = Router();

distributorRouter.get('/dist/package/list', getDistributorPackageList);
distributorRouter.get('/dist/wallet/balance', requireAuth0Bearer, getDistributorWalletBalance);
distributorRouter.post('/dist/create/order', requireAuth0Bearer, createDistOrder);

export default distributorRouter;
