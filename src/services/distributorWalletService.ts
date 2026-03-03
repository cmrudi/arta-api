import { getDistributorWalletByClientId } from '../lib/dynamoDb';

type FindDistributorWalletBalanceResult = {
  balance: number;
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

export const findDistributorWalletBalance = async (
  clientId: string,
): Promise<FindDistributorWalletBalanceResult> => {
  const wallet = await getDistributorWalletByClientId(clientId);
  const walletItem = wallet.Items?.[0];

  return {
    balance: parseBalance(walletItem?.balance),
  };
};
