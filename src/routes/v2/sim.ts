import { Router } from 'express';

import { putSimEmail } from '../../controllers/v2/simController';
import { requireAuth0Bearer } from '../../middlewares/auth0BearerAuth';

const simRouter = Router();

simRouter.put('/sim/email', requireAuth0Bearer, putSimEmail);

export default simRouter;
