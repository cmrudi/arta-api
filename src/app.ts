import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import v2Router from './routes/v2';

dotenv.config();

const app = express();
const docsPath = path.resolve(process.cwd(), 'docs');

app.set('trust proxy', true);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'script-src': ["'self'", 'https://cdn.redoc.ly'],
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/docs', (req, res, next) => {
  const forwardedProto = req.get('x-forwarded-proto');

  if (forwardedProto && forwardedProto !== 'https') {
    const host = req.get('host');

    if (host) {
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
  }

  next();
});
app.get('/docs', (_req, res) => {
  res.sendFile(path.join(docsPath, 'index.html'));
});
app.use('/docs', express.static(docsPath));
app.use('/v2', v2Router);

app.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is healthy',
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.status(200).json({
    message: 'Welcome to arta-api',
  });
});

export default app;
