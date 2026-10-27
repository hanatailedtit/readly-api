import jwt from 'jsonwebtoken';
import { GoogleTokenType, GoogleUserInfoType } from '../model/auth';

export const getGoogleTokenByCode = async (
  code: string,
): Promise<GoogleTokenType | null> => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    signal: AbortSignal.timeout(3000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code: code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: process.env.GOOGLE_REDIRECT_URI || '',
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) return null;

  const data = await response.json();
  if (typeof data?.access_token !== 'string' || !data.access_token.trim()) {
    return null;
  }

  return data;
};

export const getGoogleUserInfo = async (
  accessToken: string,
): Promise<GoogleUserInfoType | null> => {
  const response = await fetch(
    'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
    {
      signal: AbortSignal.timeout(3000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) return null;

  const userInfo = await response.json();
  if (typeof userInfo?.id !== 'string' || !userInfo.id.trim()) {
    return null;
  }

  return userInfo;
};

export const generateJwtToken = (payload: Pick<GoogleUserInfoType, 'id'>) => {
  const secretKey = process.env.JWT_SECRET_KEY;
  const token = jwt.sign(payload, secretKey, { expiresIn: '1h' });
  return token;
};

export const decodeJwtToken = (
  accessToken: string | null,
): Pick<GoogleUserInfoType, 'id'> => {
  const secretKey = process.env.JWT_SECRET_KEY;

  try {
    const isVerify = jwt.verify(accessToken, secretKey);

    if (!isVerify) throw new Error('invalid token');

    const decoded = jwt.decode(accessToken);

    return decoded;
  } catch (e) {
    return e;
  }
};
