import { getDistributorWalletByClientId } from '../lib/dynamoDb';

type FindDistributorWalletBalanceResult = {
  balance: number;
  distributorName: string;
  distributorId: string;
  email: string;
};

const parseBalance = (value: unknown): number => {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
};

const parseDistributorName = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
};

const parseDistributorId = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
};

const parseEmail = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }

  return '';
};

export const findDistributorWalletBalance = async (
  clientId: string,
): Promise<FindDistributorWalletBalanceResult> => {
  const wallet = await getDistributorWalletByClientId(clientId);
  const walletItem = wallet.Items?.[0];

  return {
    balance: parseBalance(walletItem?.balance),
    distributorName: parseDistributorName(walletItem?.distributorName),
    distributorId: parseDistributorId(walletItem?.distributorId),
    email: parseEmail(walletItem?.email),
  };
};
