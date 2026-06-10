import app from '../backend/src/server.js';

export default function handler(req, res) {
  const path = Array.isArray(req.query?.path) ? req.query.path.join('/') : req.query?.path;
  if (path) {
    const queryIndex = req.url.indexOf('?');
    const query = queryIndex >= 0 ? req.url.slice(queryIndex) : '';
    req.url = `/api/${path}${query}`;
  } else if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? req.url : `/${req.url}`}`;
  }

  return app(req, res);
}
