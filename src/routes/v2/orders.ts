import { Router } from 'express';

import {
	getInProgressOrders,
	getOrders,
} from '../../controllers/v2/ordersController';

const ordersRouter = Router();

ordersRouter.get('/partner/orders', getOrders);
ordersRouter.get('/in-progress/orders', getInProgressOrders);

export default ordersRouter;
