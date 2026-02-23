import { Router } from 'express';

import { validatePromotion } from '../../controllers/v2/promotionController';

const promotionRouter = Router();

promotionRouter.get('/promo/validate/:productCode/:promoCode', validatePromotion);

export default promotionRouter;
