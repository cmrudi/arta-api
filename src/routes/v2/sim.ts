import { Router } from 'express';

import { putSimEmail } from '../../controllers/v2/simController';
import { requireAuth0EndUser } from '../../middlewares/auth0EndUserAuth';

const simRouter = Router();

// End-user route: authorized with the browser's Auth0 ID token, not an
// API-audience machine token.
simRouter.put('/sim/email', requireAuth0EndUser, putSimEmail);

export default simRouter;
