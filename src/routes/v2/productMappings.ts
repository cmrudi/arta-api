import { Router } from 'express';

import {
  getAdminProducts,
  getProductMappings,
  updateSupplierCosts,
} from '../../controllers/v2/productMappingsController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';
import { requireAuth0Role } from '../../middlewares/auth0RoleAuth';
import { PARTNER_PAYOUT_ROLE } from '../../models/partnerPayout';

const productMappingsRouter = Router();

productMappingsRouter.get('/products', getProductMappings);
productMappingsRouter.post('/products/supplier/cost/update', updateSupplierCosts);

// Finance: full catalogue with provider, supplier IDs and supplier cost for the
// arta-admin Products dashboard. The public /products above strips those.
productMappingsRouter.get('/admin/products', requireAuth0Bearer, requireAuth0Role(PARTNER_PAYOUT_ROLE), getAdminProducts);

export default productMappingsRouter;