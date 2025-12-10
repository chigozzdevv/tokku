import { FastifyInstance } from 'fastify';
import { AuthController} from './auth.controller';

const authController = new AuthController();

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    '/nonce',
    {
      schema: {
        body: {
          type: 'object',
          required: ['publicKey'],
          properties: {
            publicKey: { type: 'string', minLength: 1 },
          },
        },
        tags: ['Authentication'],
        summary: 'Get wallet auth nonce',
        description: 'Generate a one-time nonce for wallet sign-in',
      },
    },
    authController.nonce
  );
  fastify.post(
    '/sign-in',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message', 'signature', 'publicKey'],
          properties: {
            message: { type: 'string', minLength: 1 },
            signature: { type: 'string', minLength: 1 },
            publicKey: { type: 'string', minLength: 1 },
          },
        },
        tags: ['Authentication'],
        summary: 'Sign in with wallet',
        description: 'Authenticate using Solana wallet signature',
        response: {
          201: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  user: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      walletAddress: { type: 'string' },
                    },
                  },
                  token: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    authController.signIn
  );

  // Require authentication for these routes
  fastify.register(async function (fastify) {
    fastify.addHook('preHandler', async (request, reply) => {
      await fastify.verifyJWT(request, reply);
    });

    fastify.post(
      '/refresh',
      {
        schema: {
          tags: ['Authentication'],
          summary: 'Refresh auth token',
          description: 'Refresh JWT token for authenticated user',
        },
      },
      authController.refresh
    );

    fastify.get(
      '/me',
      {
        schema: {
          tags: ['Authentication'],
          summary: 'Get user profile',
          description: 'Retrieve authenticated user information',
        },
      },
      authController.me
    );
  });
}
