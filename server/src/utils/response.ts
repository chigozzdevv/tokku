import { FastifyReply } from 'fastify';
import { ApiResponse, PaginatedResponse } from '@/shared/types';

export function success<T>(reply: FastifyReply, data: T, message?: string) {
  return reply.status(200).send({
    success: true,
    data,
    message,
  } as ApiResponse<T>);
}

export function created<T>(reply: FastifyReply, data: T, message?: string) {
  return reply.status(201).send({
    success: true,
    data,
    message,
  } as ApiResponse<T>);
}

export function paginated<T>(
  reply: FastifyReply,
  items: T[],
  total: number,
  page: number,
  limit: number,
  message?: string
) {
  const totalPages = Math.ceil(total / limit);
  
  return reply.status(200).send({
    success: true,
    data: {
      items,
      total,
      page,
      limit,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    } as PaginatedResponse<T>,
    message,
  } as ApiResponse<PaginatedResponse<T>>);
}

export function notFound(reply: FastifyReply, message: string = 'Resource not found') {
  return reply.status(404).send({
    success: false,
    error: 'NOT_FOUND',
    message,
  } as ApiResponse);
}

export function badRequest(reply: FastifyReply, message: string = 'Bad request') {
  return reply.status(400).send({
    success: false,
    error: 'BAD_REQUEST',
    message,
  } as ApiResponse);
}

export function unauthorized(reply: FastifyReply, message: string = 'Unauthorized') {
  return reply.status(401).send({
    success: false,
    error: 'UNAUTHORIZED',
    message,
  } as ApiResponse);
}

export function forbidden(reply: FastifyReply, message: string = 'Forbidden') {
  return reply.status(403).send({
    success: false,
    error: 'FORBIDDEN',
    message,
  } as ApiResponse);
}
