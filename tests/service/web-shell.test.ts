import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';

describe('service web shell', () => {
  it('serves the built web app and static assets', async () => {
    const webDistDir = mkdtempSync(path.join(tmpdir(), 'yksprite-web-'));
    const assetsDir = path.join(webDistDir, 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(
      path.join(webDistDir, 'index.html'),
      '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>'
    );
    writeFileSync(path.join(assetsDir, 'app.js'), 'console.log("yk");');

    const app = buildServiceApp({ webDistDir });

    try {
      const indexResponse = await app.inject({ method: 'GET', url: '/' });
      const assetResponse = await app.inject({ method: 'GET', url: '/assets/app.js' });

      expect(indexResponse.statusCode).toBe(200);
      expect(indexResponse.headers['content-type']).toContain('text/html');
      expect(indexResponse.body).toContain('<div id="root"></div>');

      expect(assetResponse.statusCode).toBe(200);
      expect(assetResponse.headers['content-type']).toContain('javascript');
      expect(assetResponse.body).toContain('console.log("yk");');
    } finally {
      await app.close();
      rmSync(webDistDir, { recursive: true, force: true });
    }
  });
});
