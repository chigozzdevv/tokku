import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyJWT } from '@/utils/auth';
import { asyncHandler } from '@/utils/errors';

export const requireAuth = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
  await verifyJWT(request, reply);
});
