import { Request, Response } from 'express';

import { REVIEW_KINDS, isReviewKind, reasonsFor } from '../../models/simReview';
import { findSimReviews, submitSimReview } from '../../services/simReviewService';

export const postSimReview = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const simId = String(req.params.SimId || '').trim();

  if (!simId) {
    return res.status(400).json({
      success: false,
      message: 'path param SimId is required',
    });
  }

  const body = (req.body || {}) as {
    kind?: unknown;
    rating?: unknown;
    installed?: unknown;
    reason?: unknown;
    comment?: unknown;
    smdpStatus?: unknown;
  };

  // Default keeps the original single-purpose call working.
  const kind = body.kind === undefined ? 'SERVICE' : body.kind;

  if (!isReviewKind(kind)) {
    return res.status(400).json({
      success: false,
      message: `kind must be one of: ${REVIEW_KINDS.join(', ')}`,
    });
  }

  try {
    const result = await submitSimReview({
      simId,
      kind,
      rating: body.rating,
      installed: body.installed,
      reason: body.reason,
      comment: body.comment,
      smdpStatus: body.smdpStatus,
    });

    if (!result.success) {
      if (result.reason === 'INVALID_RATING') {
        return res.status(400).json({
          success: false,
          message: 'rating must be an integer between 1 and 5',
        });
      }

      if (result.reason === 'INVALID_INSTALLED') {
        return res.status(400).json({
          success: false,
          message: 'installed must be a boolean',
        });
      }

      if (result.reason === 'INVALID_REASON') {
        return res.status(400).json({
          success: false,
          message: `reason must be one of: ${reasonsFor(kind).join(', ')}`,
        });
      }

      if (result.reason === 'SIM_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          message: 'SimId not found',
        });
      }

      return res.status(400).json({
        success: false,
        message: 'could not store review',
      });
    }

    return res.status(result.action === 'created' ? 201 : 200).json({
      success: true,
      action: result.action,
      review: result.review,
    });
  } catch (error) {
    console.error('Failed to store SIM review', error);

    return res.status(500).json({
      success: false,
      message: 'failed to store review',
    });
  }
};

export const getSimReviews = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const simId = String(req.params.SimId || '').trim();

  if (!simId) {
    return res.status(400).json({
      success: false,
      message: 'path param SimId is required',
    });
  }

  try {
    const reviews = await findSimReviews(simId);

    return res.status(200).json({ success: true, reviews });
  } catch (error) {
    console.error('Failed to read SIM reviews', error);

    return res.status(500).json({
      success: false,
      message: 'failed to read reviews',
    });
  }
};
