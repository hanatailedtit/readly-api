import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import fileUpload from 'express-fileupload';
import authRouter from './auth';
import bookRouter from './book';
import commentRouter from './comment';
import userRouter from './user';

export const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'https://readlyapi.createdoodle.dev',
].filter(Boolean) as string[];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.createdoodle.dev')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
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
