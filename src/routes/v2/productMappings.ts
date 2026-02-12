import { Router } from 'express';

import { getProductMappings } from '../../controllers/v2/productMappingsController';

const productMappingsRouter = Router();

productMappingsRouter.get('/products', getProductMappings);

export default productMappingsRouter;