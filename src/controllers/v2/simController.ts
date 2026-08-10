import { Request, Response } from 'express';

import { AuthenticatedLocals, getAuth0Email } from '../../middlewares/auth0BearerAuth';
import { assignSimEmail } from '../../services/simEmailService';

export const putSimEmail = async (
  req: Request,
  res: Response<unknown, AuthenticatedLocals>,
): Promise<Response> => {
  const iccid = (req.body as { iccid?: unknown })?.iccid;

  if (typeof iccid !== 'string' || !iccid.trim()) {
    return res.status(400).json({
      success: false,
      message: 'request body iccid is required',
    });
  }

  const email = getAuth0Email(res.locals.auth);

  if (!email) {
    return res.status(403).json({
      success: false,
      message: 'access token does not carry an email claim',
    });
  }

  try {
    const result = await assignSimEmail(iccid.trim(), email);

    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(200).json({
      success: true,
      action: result.action,
      iccid: result.iccid,
      email: result.email,
      simId: result.simId,
      simCard: result.simCard,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'failed to assign email to sim',
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
};
