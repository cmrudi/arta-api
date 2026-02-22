import { Router } from 'express';

import {
	forceRefundOrder,
	getInProgressOrders,
	getOrders,
} from '../../controllers/v2/ordersController';

const ordersRouter = Router();

ordersRouter.get('/partner/orders', getOrders);
ordersRouter.get('/in-progress/orders', getInProgressOrders);
ordersRouter.post('/refund/force', forceRefundOrder);

export default ordersRouter;
