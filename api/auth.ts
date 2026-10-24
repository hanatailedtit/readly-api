import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import express, { Request, Response } from 'express';
import {
  generateJwtToken,
  getGoogleTokenByCode,
  getGoogleUserInfo,
} from '../utils/auth';
import { isExistRows } from '../utils/sql';

const authRouter = express.Router();

authRouter.post('/sign-up', async (req: Request, res: Response) => {
  const userId = req.body?.user_id;
  const password = req.body?.password;
  const nickname = req.body?.nickname;

  if (!userId || !password || !nickname) {
    res.status(400).send('A required parameter is missing.');
    return;
  }

  const encryptedPassword = await bcrypt.hash(password, 10);

  await sql`INSERT INTO users (id, nickname, user_id, password)
      VALUES (gen_random_uuid()::text, ${nickname}, ${userId}, ${encryptedPassword});`;

  res.send('Success sign up.');
});

authRouter.post('/sign-up/id-check', async (req: Request, res: Response) => {
  const userId = req.body?.user_id;

  if (!userId) {
    res.status(400).send('A required parameter is missing.');
    return;
  }

  const { rows } = await sql`
  SELECT EXISTS (
    SELECT 1 
    FROM users 
    WHERE user_id = ${userId}
  );`;

  if (isExistRows(rows)) {
    res.json({
      isExist: true,
      message: '중복된 아이디입니다.',
    });
    return;
  }

  res.json({ isExist: false });
});

authRouter.post(
  '/sign-up/nickname-check',
  async (req: Request, res: Response) => {
    const nickname = req.body?.nickname;

    if (!nickname) {
      res.status(400).send('A required parameter is missing.');
      return;
    }

    const { rows } = await sql`
  SELECT EXISTS (
    SELECT 1 
    FROM users 
    WHERE nickname = ${nickname}
  );`;

    if (isExistRows(rows)) {
      res.json({
        isExist: true,
        message: '중복된 닉네임입니다.',
      });
      return;
    }

    res.json({ isExist: false });
  },
);

authRouter.post('/login', async (req: Request, res: Response) => {
  const userId = req.body?.user_id;
  const password = req.body?.password;

  if (!userId || !password) {
    res.status(400).send('A required parameter is missing.');
    return;
  }

  const { rows } =
    await sql`SELECT id, password FROM users WHERE user_id = ${userId};`;
  const row = rows[0];

  if (!row) {
    res.json({
      isSuccess: false,
      message: '아이디와 비밀번호를 확인해주세요.',
    });
    return;
  }

  const isCollectPassword = await bcrypt.compare(password, row.password);

  if (!isCollectPassword) {
    res.json({
      isSuccess: false,
      message: '아이디와 비밀번호를 확인해주세요.',
    });
    return;
  }

  const accessToken = generateJwtToken({ id: row.id });

  res.json({ isSuccess: true, accessToken });
});

authRouter.post('/login/google', async (req: Request, res: Response) => {
  const code = req.body.code;

  const token = await getGoogleTokenByCode(code);

  if (!token) {
    res.send('login failed');
    return;
  }

  const userInfo = await getGoogleUserInfo(token.access_token);

  const accessToken = generateJwtToken({ id: userInfo.id });

  const { rows } = await sql`
  SELECT EXISTS (
    SELECT 1 
    FROM users 
    WHERE id = ${userInfo.id}
  );`;

  if (isExistRows(rows)) {
    res.send({ message: 'login success', accessToken });
    return;
  }

  await sql`
  INSERT INTO users 
    (id, email, nickname) 
  VALUES (${userInfo.id}, ${userInfo.email}, ${userInfo.name});`;
  res.send({ message: 'regist user', accessToken });
});

export default authRouter;
