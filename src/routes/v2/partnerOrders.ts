import { Router } from 'express';

import { getPartnerOrders } from '../../controllers/v2/partnerOrdersController';

const partnerOrdersRouter = Router();

partnerOrdersRouter.get('/partner/orders', getPartnerOrders);

export default partnerOrdersRouter;
