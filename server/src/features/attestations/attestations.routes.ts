import { FastifyInstance } from 'fastify';
import { AttestationsController } from './attestations.controller';

const attestationsController = new AttestationsController();

export async function attestationsRoutes(fastify: FastifyInstance) {
  
  fastify.get(
    '/integrity',
    {
      schema: {
        tags: ['Attestations'],
        summary: 'TEE integrity status',
        description: 'Return current TEE integrity verification status',
      },
    },
    attestationsController.verifyteeIntegrity
  );

  fastify.get(
    '/hash/:hash',
    {
      schema: {
        tags: ['Attestations'],
        summary: 'Get attestation by hash',
        description: 'Retrieve attestation details by its hash',
        params: {
          type: 'object',
          properties: {
            hash: { type: 'string' },
          },
          required: ['hash'],
        },
      },
    },
    attestationsController.getAttestationByHash
  );

  fastify.get(
    '/round/:roundId',
    {
      schema: {
        tags: ['Attestations'],
        summary: 'Get attestations by round',
        description: 'Get all attestations for a specific round',
        params: {
          type: 'object',
          properties: {
            roundId: { type: 'string' },
          },
          required: ['roundId'],
        },
      },
    },
    attestationsController.getAttestationsByRound
  );

  fastify.get(
    '/proof/:hash',
    {
      schema: {
        tags: ['Attestations'],
        summary: 'Get attestation proof',
        description: 'Get detailed proof information for verification',
        params: {
          type: 'object',
          properties: {
            hash: { type: 'string' },
          },
          required: ['hash'],
        },
      },
    },
    attestationsController.getAttestationProof
  );

  fastify.get(
    '/stats',
    {
      schema: {
        tags: ['Attestations'],
        summary: 'Get attestation statistics',
        description: 'Get attestation verification statistics',
        querystring: {
          type: 'object',
          properties: {
            marketId: { type: 'string' },
          },
        },
      },
    },
    attestationsController.getAttestationStats
  );

  fastify.get(
    '/tee-integrity',
    {
      schema: {
        tags: ['Attestations'],
        summary: 'Verify TEE integrity',
        description: 'Verify the integrity of the Trusted Execution Environment',
      },
    },
    attestationsController.verifyteeIntegrity
  );

  // Admin route for manual verification
  fastify.post(
    '/:hash/verify',
    {
      schema: {
        tags: ['Attestations (Admin)'],
        summary: 'Manual verification',
        description: 'Manually trigger attestation verification',
        params: {
          type: 'object',
          properties: {
            hash: { type: 'string' },
          },
          required: ['hash'],
        },
      },
    },
    attestationsController.verifyAttestation
  );
}
