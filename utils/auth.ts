import jwt from 'jsonwebtoken';
import { GoogleTokenType, GoogleUserInfoType } from '../model/auth';

export const getGoogleTokenByCode = async (
  code: string,
): Promise<GoogleTokenType | null> => {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
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

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error exchanging authorization code:', error);
    return null;
  }
};

export const getGoogleUserInfo = async (
  accessToken: string,
): Promise<GoogleUserInfoType> => {
  const userInfo = await fetch(
    'https://www.googleapis.com/oauth2/v1/userinfo?alt=json',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  return userInfo.json();
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
