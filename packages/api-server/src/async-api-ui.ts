import { Application } from 'express';
import { createRequire } from 'node:module';
import { generateAsyncApiSpec } from './asyncapi.js';
import swaggerUi from 'swagger-ui-express';

export function asyncApiUi(app: Application) {
  // OpenAPI spec — generated at build time by @ai-team/api-contracts (ts-http-openapi)
  const _require = createRequire(import.meta.url);
  const swaggerSpec = _require('@ai-team/api-contracts/openapi.json');

  // Swagger API documentation
  app.use(
    '/api-docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'AI Team API Documentation',
    })
  );

  // Swagger JSON spec endpoint
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(swaggerSpec);
  });
  const asyncApiSpec = generateAsyncApiSpec();

  app.get('/asyncapi.json', (_, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.json(asyncApiSpec);
  });

  app.get('/asyncapi', (_, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>AI Team WebSocket API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/@asyncapi/react-component@1.4.10/styles/default.min.css">
  <style>
    body { margin: 0; padding: 0; }
    #asyncapi { height: 100vh; overflow: auto; }
  </style>
</head>
<body>
  <div id="asyncapi"></div>
  <script src="https://unpkg.com/@asyncapi/react-component@1.4.10/browser/standalone/index.js"></script>
  <script>
    AsyncApiStandalone.render({
      schema: {
        url: '/asyncapi.json'
      },
      config: {
        show: {
          sidebar: true
        }
      }
    }, document.getElementById('asyncapi'));
  </script>
</body>
</html>
    `);
  });
}
