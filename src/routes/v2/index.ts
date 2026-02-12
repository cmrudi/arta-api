import { Router } from 'express';

import partnerOrdersRouter from './partnerOrders';
import productMappingsRouter from './productMappings';
import regionsRouter from './regions';

const v2Router = Router();

v2Router.use(partnerOrdersRouter);
v2Router.use(productMappingsRouter);
v2Router.use(regionsRouter);

export default v2Router;
