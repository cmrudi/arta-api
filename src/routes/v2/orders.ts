import { Router } from 'express';

import {
	forceRefundOrder,
	getInProgressOrders,
	getOrders,
	recoverOrder,
} from '../../controllers/v2/ordersController';

const ordersRouter = Router();

ordersRouter.get('/partner/orders', getOrders);
ordersRouter.get('/in-progress/orders', getInProgressOrders);
ordersRouter.post('/refund/force', forceRefundOrder);
ordersRouter.post('/order/recovery', recoverOrder);

export default ordersRouter;
