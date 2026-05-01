import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { AutoAnswerRepository } from '../auto-answer/auto-answer-repository.js';

const readCaptureFile = async (filePath: string) => {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (!filePath.startsWith('/app/data/')) {
      throw error;
    }
    const localDataPath = path.resolve(process.cwd(), 'data', path.relative('/app/data', filePath));
    return readFile(localDataPath);
  }
};

export const registerAnswerRoutes = (app: FastifyInstance, autoAnswerRepository: AutoAnswerRepository) => {
  app.get('/answers', async (request) => {
    const query = request.query as { limit?: string } | undefined;
    const limit = Math.min(200, Math.max(1, Number(query?.limit) || 100));
    return autoAnswerRepository.listAnswerHistory(limit);
  });

  app.get('/answers/captures/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { message: 'Invalid capture id' };
    }

    const capture = autoAnswerRepository.getAnswerCaptureFile(id);
    if (!capture) {
      reply.code(404);
      return { message: 'Capture not found' };
    }

    try {
      const file = await readCaptureFile(capture.filePath);
      reply.type(capture.mimeType);
      return file;
    } catch {
      reply.code(404);
      return { message: 'Capture file not found' };
    }
  });
};
