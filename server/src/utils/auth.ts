import { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '@/config/env';
import { AuthenticationError, NotFoundError } from '@/shared/errors';
import { JwtPayload } from '@/shared/types';
import { User } from '@/config/database';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      walletAddress: string;
    };
  }
}

export async function verifyJWT(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid authorization header');
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    throw new AuthenticationError('Missing token');
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const payload = decoded as JwtPayload;

    // Verify user exists in database
    const user = await User.findById(payload.userId).select({ _id: 1, walletAddress: 1 }).lean();

    if (!user) {
      throw new NotFoundError('User');
    }

    request.user = { id: user.id || (user as any)._id?.toString(), walletAddress: user.walletAddress };
  } catch (error) {
    throw new AuthenticationError('Invalid or expired token');
  }
}

export function generateJWT(userId: string, walletAddress: string): string {
  const payload: JwtPayload = {
    userId,
    walletAddress,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60), // 7 days
  };

  return jwt.sign(payload, config.JWT_SECRET);
}

export async function verifySolanaMessage(
  message: string,
  signature: string,
  publicKey: string
): Promise<boolean> {
  try {
    const { PublicKey } = await import('@solana/web3.js');
    const nacl = await import('tweetnacl');
    const bs58 = await import('bs58');

    const pubKey = new PublicKey(publicKey);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.default.decode(signature);

    return nacl.default.sign.detached.verify(
      messageBytes,
      signatureBytes,
      pubKey.toBytes()
    );
  } catch (error) {
    return false;
  }
}
