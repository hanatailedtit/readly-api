import { del, put } from '@vercel/blob';
import { sql } from '@vercel/postgres';
import express, { Request, Response } from 'express';
import { decodeJwtToken } from '../utils/auth';

const userRouter = express.Router();

userRouter.get('/my-info', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  if (!userToken) {
    res.json(null);
    return;
  }

  const decodedInfo = decodeJwtToken(userToken);

  const { rows } = await sql`
  SELECT *
  FROM users
  WHERE id = ${decodedInfo.id};`;

  const row = rows[0];

  if (!row) {
    res.json(null);
    return;
  }

  res.json(row);
});

userRouter.get('/info', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  const decodedInfo = decodeJwtToken(String(userToken));

  const userId = req.query?.user_id;

  if (!userId) {
    res.status(400).send('A required parameter is missing.');
    return;
  }

  const { rows } = await sql`
  SELECT *
  FROM users
  WHERE id = ${String(userId)};`;

  const row = rows[0];

  if (!row) {
    res.json(null);
    return;
  }

  res.json({ ...row, is_my: userId === decodedInfo.id });
});

userRouter.put('/edit/nickname', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  if (!userToken) {
    res.status(401).send('You entered via the wrong route.');
    return;
  }

  const decodedInfo = decodeJwtToken(userToken);

  const nickname = req.body?.nickname;

  await sql`
  UPDATE users
  SET nickname = ${nickname}
  WHERE id = ${decodedInfo.id};`;

  res.send('Success edited.');
});

userRouter.post('/edit/profile-image', async (req: Request, res: Response) => {
  const userToken = req.headers['authorization']?.split(' ')[1];

  if (!userToken) {
    res.status(401).send('You entered via the wrong route.');
    return;
  }

  const decodedInfo = decodeJwtToken(userToken);

  const { rows } =
    await sql`SELECT profile_image FROM users WHERE id = ${decodedInfo.id}`;

  if (!rows || rows.length <= 0) {
    res.status(401).send('User does not exist.');
    return;
  }

  const row = rows[0];

  if (row.profile_image) {
    await del(row.profile_image);
  }

  let image = req.files?.image;

  if (!image) {
    res.status(400).send('A required parameter is missing.');
    return;
  }

  if (Array.isArray(image)) {
    image = image[0];
  }

  const blob = await put(
    `readly/user/profile-image/${image.name}`,
    image.data,
    {
      access: 'public',
    },
  );

  await sql`
  UPDATE users
  SET profile_image = ${blob.url}
  WHERE id = ${decodedInfo.id};`;

  res.send('Success edited.');
});

export default userRouter;
