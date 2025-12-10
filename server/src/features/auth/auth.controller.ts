import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { ValidationError } from '@/shared/errors';
import { success, created } from '@/utils/response';
import { asyncHandler } from '@/utils/errors';

const authService = new AuthService();

export class AuthController {
  nonce = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { publicKey } = request.body as { publicKey: string };
    const result = await authService.createNonce(publicKey);
    return created(reply, result, 'Nonce issued');
  });
  signIn = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    const { message, signature, publicKey } = request.body as {
      message: string;
      signature: string;
      publicKey: string;
    };

    const result = await authService.signInWithWallet(message, signature, publicKey);

    return created(reply, result, 'Authentication successful');
  });

  refresh = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new ValidationError('User not authenticated');
    }

    const result = await authService.refreshSession(request.user.id);
    
    return success(reply, result, 'Session refreshed');
  });

  me = asyncHandler(async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      throw new ValidationError('User not authenticated');
    }

    return success(reply, request.user, 'User profile retrieved');
  });
}
