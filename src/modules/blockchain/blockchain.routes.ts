import { Router } from 'express';
import { BlockchainController } from './blockchain.controller';
import { BlockchainService } from './blockchain.service';
import { BlockchainRepository } from './blockchain.repository';
import { requireAuth } from '@middleware/require-auth';
import { validate } from '@middleware/validate';
import { listBlockchainsQuerySchema } from './blockchain.validator';

/**
 * Blockchain feature module: wires its own layers (repository -> service ->
 * controller) and returns the mounted router. Read-only for now — the chain
 * list is seeded/managed out of band, not created or edited through this API.
 */
export const createBlockchainModule = (): Router => {
  const repository = new BlockchainRepository();
  const service = new BlockchainService(repository);
  const controller = new BlockchainController(service);

  const router = Router();

  /**
   * @openapi
   * /api/blockchains:
   *   get:
   *     tags: [Blockchains]
   *     summary: List supported blockchains (search + pagination)
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     parameters:
   *       - in: query
   *         name: search
   *         schema: { type: string, maxLength: 120 }
   *         description: Case-insensitive partial match on name or symbol
   *       - in: query
   *         name: chainType
   *         schema: { type: string, enum: [evm, ton, solana, tron, aptos, sui] }
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 10 }
   *     responses:
   *       200:
   *         description: OK
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 data:
   *                   type: object
   *                   properties:
   *                     data: { type: array, items: { $ref: '#/components/schemas/Blockchain' } }
   *                     meta: { $ref: '#/components/schemas/PaginationMeta' }
   *       401: { description: Missing/invalid access token }
   *       422: { description: Validation failed }
   */
  router.get('/', requireAuth, validate({ query: listBlockchainsQuerySchema }), controller.list);

  return router;
};
