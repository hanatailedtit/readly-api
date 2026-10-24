import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import fileUpload from 'express-fileupload';
import authRouter from './auth';
import bookRouter from './book';
import commentRouter from './comment';
import userRouter from './user';

export const app = express();

const corsOptions = {
  origin: process.env.CLIENT_URL,
};

app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(
  fileUpload({
    useTempFiles: false,
    tempFileDir: "/tmp/",
    abortOnLimit: true,
    limits: { fileSize: 50 * 1024 * 1024, files: 10 },
    responseOnLimit: "File size limit has been reached",
    uploadTimeout: 10000, // 10 seconds
  })
);

app.use('/auth', authRouter);
app.use('/user', userRouter);
app.use('/book', bookRouter);
app.use('/comment', commentRouter);
app.set('trust proxy', true)

module.exports = app;
