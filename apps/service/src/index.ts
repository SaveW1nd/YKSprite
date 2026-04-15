import path from 'node:path';
import { buildServiceApp } from './app.js';
import { loadEnvFile } from './env-loader.js';

loadEnvFile(path.resolve(process.cwd(), '.env'));

const app = buildServiceApp();

const start = async () => {
  try {
    await app.listen({ host: '0.0.0.0', port: 3000 });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
