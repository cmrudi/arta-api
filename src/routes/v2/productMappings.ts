import { Router } from 'express';

import {
  getProductMappings,
  updateSupplierCosts,
} from '../../controllers/v2/productMappingsController';

const productMappingsRouter = Router();

productMappingsRouter.get('/products', getProductMappings);
productMappingsRouter.post('/products/supplier/cost/update', updateSupplierCosts);

export default productMappingsRouter;