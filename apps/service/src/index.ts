import { buildServiceApp } from './app.js';

const app = buildServiceApp();

const start = async () => {
  try {
    await app.listen({ host: '0.0.0.0', port: 3000 });
    await app.bootstrapSavedSessionAutomation().catch((error) => {
      app.log.error(error);
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
