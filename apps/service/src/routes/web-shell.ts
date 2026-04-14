import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8'
};

const sendFile = async (reply: FastifyReply, filePath: string) => {
  const extname = path.extname(filePath);
  const file = await readFile(filePath);
  reply.type(CONTENT_TYPES[extname] ?? 'application/octet-stream');
  return reply.send(file);
};

export const registerWebShellRoutes = (app: FastifyInstance, webDistDir: string) => {
  if (!existsSync(webDistDir)) {
    return;
  }

  const indexPath = path.join(webDistDir, 'index.html');

  app.get('/', async (_request, reply) => {
    return sendFile(reply, indexPath);
  });

  app.get('/*', async (request, reply) => {
    const requestPath = request.url.split('?')[0];
    const relativePath = requestPath.replace(/^\/+/, '');
    const candidatePath = path.join(webDistDir, relativePath);

    if (relativePath && existsSync(candidatePath) && path.extname(candidatePath)) {
      return sendFile(reply, candidatePath);
    }

    return sendFile(reply, indexPath);
  });
};
