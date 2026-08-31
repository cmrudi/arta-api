import { Router } from 'express';

import distributorRouter from './distributor';
import orderInternalRouter from './orderInternal';
import ordersRouter from './orders';
import productMappingsRouter from './productMappings';
import promotionRouter from './promotion';
import regionsRouter from './regions';
import simRouter from './sim';
import simCheckRouter from './simCheck';
import simReviewRouter from './simReview';

const v2Router = Router();

v2Router.use(distributorRouter);
v2Router.use(orderInternalRouter);
v2Router.use(ordersRouter);
v2Router.use(productMappingsRouter);
v2Router.use(promotionRouter);
v2Router.use(regionsRouter);
v2Router.use(simRouter);
v2Router.use(simCheckRouter);
v2Router.use(simReviewRouter);

export default v2Router;
