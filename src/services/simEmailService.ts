import { randomUUID } from 'crypto';

import { querySimCardsByIccid, storeSim, updateSimCardEmail } from '../lib/dynamoDb';

type SimEmailAction = 'EMAIL_ADDED' | 'SIM_DUPLICATED' | 'ALREADY_ASSIGNED';

type AssignSimEmailSuccess = {
  success: true;
  action: SimEmailAction;
  iccid: string;
  email: string;
  simId: string;
  simCard: Record<string, unknown>;
};

type AssignSimEmailError = {
  success: false;
  reason: 'ICCID_NOT_FOUND';
  message: string;
};

export type AssignSimEmailResult = AssignSimEmailSuccess | AssignSimEmailError;

const normalizeEmail = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

export const assignSimEmail = async (
  iccid: string,
  email: string,
): Promise<AssignSimEmailResult> => {
  const simResult = await querySimCardsByIccid(iccid);
  const simCards = simResult.Items || [];

  if (simCards.length === 0) {
    return {
      success: false,
      reason: 'ICCID_NOT_FOUND',
      message: 'ICCID not found',
    };
  }

  const normalizedEmail = normalizeEmail(email);
  const now = new Date().toISOString();

  // Idempotency guard: a repeated call for the same email must not keep
  // spawning duplicate rows.
  const alreadyAssigned = simCards.find(
    (simCard) => normalizeEmail(simCard.email) === normalizedEmail,
  );

  if (alreadyAssigned) {
    return {
      success: true,
      action: 'ALREADY_ASSIGNED',
      iccid,
      email,
      simId: String(alreadyAssigned.SimId),
      simCard: alreadyAssigned,
    };
  }

  const unassigned = simCards.find((simCard) => !normalizeEmail(simCard.email));

  if (unassigned) {
    const updated = await updateSimCardEmail(String(unassigned.SimId), email, now);

    return {
      success: true,
      action: 'EMAIL_ADDED',
      iccid,
      email,
      simId: String(unassigned.SimId),
      simCard: updated.Attributes ?? { ...unassigned, email, updatedAt: now },
    };
  }

  // Every existing row already belongs to someone else — the SIM is being
  // shared, so clone the first row under a fresh SimId for this email.
  const source = simCards[0] as Record<string, unknown>;
  const simRecord: Record<string, unknown> = {
    ...source,
    SimId: randomUUID(),
    email,
    createdAt: now,
    updatedAt: now,
  };

  await storeSim(simRecord);

  return {
    success: true,
    action: 'SIM_DUPLICATED',
    iccid,
    email,
    simId: String(simRecord.SimId),
    simCard: simRecord,
  };
};
