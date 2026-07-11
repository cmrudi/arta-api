import { Router } from 'express';

import { getSimCheck } from '../../controllers/v2/simCheckController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';

const simCheckRouter = Router();

simCheckRouter.get('/sim/check/:iccid', requireAuth0Bearer, getSimCheck);

export default simCheckRouter;
