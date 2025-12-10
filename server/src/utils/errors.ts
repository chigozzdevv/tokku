import { FastifyError } from 'fastify';
import { AppError } from '@/shared/errors';
import { logger } from './logger';

export function errorHandler(error: FastifyError, request: any, reply: any) {
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Log errors
  logger.error({
    error: error.message,
    stack: error.stack,
    method: request.method,
    url: request.url,
    ip: request.ip,
    userId: request.user?.id,
  }, 'Request failed');

  // Handle known application errors
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      error: error.code,
      message: error.message,
      ...(isDevelopment && { stack: error.stack }),
    });
  }

  // Handle validation errors
  if (error.validation) {
    return reply.status(400).send({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid request parameters',
      details: error.validation,
    });
  }

  // Handle fastify errors
  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      success: false,
      error: 'FASTIFY_ERROR',
      message: error.message,
      ...(isDevelopment && { stack: error.stack }),
    });
  }

  // Default error response
  return reply.status(500).send({
    success: false,
    error: 'INTERNAL_ERROR',
    message: isDevelopment ? error.message : 'Internal server error',
    ...(isDevelopment && { stack: error.stack }),
  });
}

export function asyncHandler(fn: Function) {
  return async (request: any, reply: any) => {
    try {
      return await fn(request, reply);
    } catch (error) {
      throw error;
    }
  };
}
