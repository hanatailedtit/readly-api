import { del, put } from '@vercel/blob';
import express, { Request, Response } from 'express';
import { decodeJwtToken } from '../utils/auth';
import { sql } from '../utils/sql';

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

  const { password: _password, ...user } = row;
  res.json(user);
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

  const { password: _password, ...user } = row;
  res.json({ ...user, is_my: userId === decodedInfo.id });
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

  if (!decodedInfo.id) {
    res.status(401).send('Decoding failed.');
    return;
  }

  let image = req.files?.image;
  if (Array.isArray(image)) image = image[0];

  if (!image) {
    res.status(400).send('A required parameter is missing.');
    return;
  }

  if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(image.mimetype)) {
    res.status(400).send('Unsupported image type.');
    return;
  }

  if (!image.size || image.truncated || image.size > 5 * 1024 * 1024) {
    res.status(400).send('Image must be non-empty and no larger than 5 MB.');
    return;
  }

  try {
    const { rows } =
      await sql`SELECT profile_image FROM users WHERE id = ${decodedInfo.id}`;

    const row = rows[0];
    if (!row) {
      res.status(401).send('User does not exist.');
      return;
    }

    const blob = await put(
      `readly/user/profile-image/${image.name}`,
      image.data,
      {
        access: 'public',
        contentType: image.mimetype,
        addRandomSuffix: true,
        abortSignal: AbortSignal.timeout(10000),
      },
    );

    const { rowCount } = await sql`
    UPDATE users
    SET profile_image = ${blob.url}
    WHERE id = ${decodedInfo.id};`;

    // shortcut: an unsuccessful DB save may leave an unused upload; clean up in a background job if these accumulate.
    if (!rowCount) throw new Error('User no longer exists.');

    try {
      if (row.profile_image && new URL(row.profile_image).hostname === new URL(blob.url).hostname) {
        await del(row.profile_image, { abortSignal: AbortSignal.timeout(3000) });
      }
    } catch (error) {
      console.warn('Previous profile image cleanup failed:', error instanceof Error ? error.message : 'Unknown error');
    }

    res.send('Success edited.');
  } catch (error) {
    console.error('Profile image save failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Failed to save profile image.' });
  }
});

export default userRouter;
