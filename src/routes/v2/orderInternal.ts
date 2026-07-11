import { Router } from 'express';

import { createInternalOrder } from '../../controllers/v2/orderInternalController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';

const orderInternalRouter = Router();

orderInternalRouter.post('/order/internal', requireAuth0Bearer, createInternalOrder);

export default orderInternalRouter;
