import { Router } from 'express';

import partnerOrdersRouter from './partnerOrders';

const v2Router = Router();

v2Router.use(partnerOrdersRouter);

export default v2Router;
