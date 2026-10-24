import { sql } from '@vercel/postgres';
import express, { Request, Response } from 'express';
import { decodeJwtToken } from '../utils/auth';

const commentRouter = express.Router();

commentRouter.post('/create', async (req: Request, res: Response) => {
  const comment = req.body?.comment;
  const summaryId = req.body?.summary_id;
  const commentId = req.body?.comment_id || null;

  if (!comment || !summaryId) {
    res.status(401).send('A required parameter is missing.');
    return;
  }

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

  const { rows } = await sql`
  SELECT id, nickname, profile_image 
  FROM users 
  WHERE id = ${decodedInfo.id};`;

  const row = rows[0];

  if (!row) {
    res.status(401).send('There is no user information.');
    return;
  }

  await sql`
  INSERT INTO summary_comment (comment, summary_id, comment_id, user_id, user_image, user_name)
  VALUES (${comment}, ${summaryId}, ${commentId}, ${row.id}, ${row.profile_image}, ${row.nickname});
  `;
  res.send('Success create comment.');
});

commentRouter.get('/list', async (req: Request, res: Response) => {
  const summaryId = req.query?.summary_id;
  const userToken = req.headers['authorization']?.split(' ')[1];

  const decodedInfo = decodeJwtToken(userToken || null);

  const { rows } = await sql`
    SELECT summary_comment.*, users.nickname AS user_name, users.profile_image AS user_image
    FROM summary_comment
    LEFT JOIN users
    ON summary_comment.user_id = users.id
    WHERE summary_comment.summary_id = ${String(summaryId)}`;

  const parsedRows = rows.map((item) => {
    return {
      ...item,
      is_my: item.user_id === decodedInfo.id,
    };
  });
  res.json(parsedRows);
});

commentRouter.delete('/delete', async (req: Request, res: Response) => {
  const id = req.query?.id;

  if (!id) {
    res.status(401).send('A required parameter is missing.');
  }

  const { rowCount } = await sql`
  DELETE 
  FROM summary_comment
  WHERE id = ${String(id)};`;

  if (!rowCount || rowCount <= 0) {
    res.status(401).send('Comment does not exist.');
    return;
  }

  res.send('Success deleted.');
});

export default commentRouter;
