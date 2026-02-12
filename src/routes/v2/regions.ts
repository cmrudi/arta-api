import { Router } from 'express';

import { getRegions } from '../../controllers/v2/regionsController';

const regionsRouter = Router();

regionsRouter.get('/regions', getRegions);

export default regionsRouter;
