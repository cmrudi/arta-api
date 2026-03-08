type RequestDistributorOauthTokenParams = {
  clientId: string;
  clientSecret: string;
};

type RequestDistributorOauthTokenResult = {
  statusCode: number;
  payload: Record<string, unknown>;
};

const auth0OauthBaseUrl = process.env.AUTH0_OAUTH_BASE_URL || 'https://artamobile.us.auth0.com';
const auth0OauthAudience = 'https://api.artamobile.id';
const auth0OauthGrantType = 'client_credentials';

export const requestDistributorOauthToken = async (
  params: RequestDistributorOauthTokenParams,
): Promise<RequestDistributorOauthTokenResult> => {
  const response = await fetch(`${auth0OauthBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      audience: auth0OauthAudience,
      grant_type: auth0OauthGrantType,
    }),
  });

  let payload: Record<string, unknown> = {};

  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  return {
    statusCode: response.status,
    payload,
  };
};
