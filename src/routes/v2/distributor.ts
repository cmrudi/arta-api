import { Router } from 'express';

import { getDistributorPackageList } from '../../controllers/v2/distributorController';

const distributorRouter = Router();

distributorRouter.get('/dist/package/list', getDistributorPackageList);

export default distributorRouter;
