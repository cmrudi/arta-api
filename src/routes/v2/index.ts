import { Router } from 'express';

import ordersRouter from './orders';
import productMappingsRouter from './productMappings';
import promotionRouter from './promotion';
import regionsRouter from './regions';

const v2Router = Router();

v2Router.use(ordersRouter);
v2Router.use(productMappingsRouter);
v2Router.use(promotionRouter);
v2Router.use(regionsRouter);

export default v2Router;
