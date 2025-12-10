import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import { config } from './env';
import { verifyJWT } from '@/utils/auth';

export async function registerPlugins(app: any) {
  // CORS
  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
  });

  // Security headers
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  });

  // Rate limiting
  await app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_MAX_REQUESTS,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    skipOnError: true,
    keyGenerator: (request: any) => request.ip,
    errorResponseBuilder: (request: any, context: any) => ({
      code: 'RATE_LIMIT_EXCEEDED',
      error: 'Rate limit exceeded',
      expiresIn: Math.round(context.ttl / 1000),
      current: context.current,
      max: 1,
    }),
  });

  // API documentation
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'TOSSR.gg API',
        description: 'Provably Random Gaming Platform',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost:3001', description: 'Development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: ({ schema, url }: any) => ({ schema, url }),
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      displayRequestDuration: true,
    },
  });

  // Auth decorator for route hooks
  if (!app.verifyJWT) {
    app.decorate('verifyJWT', verifyJWT);
  }

  // Request logging
  app.addHook('onRequest', (request: any, reply: any, done: any) => {
    (request as any).startTime = Date.now();
    done();
  });

  app.addHook('onResponse', (request: any, reply: any, done: any) => {
    const duration = Date.now() - (request.startTime || Date.now());
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration,
      ip: request.ip,
    });
    done();
  });
}
