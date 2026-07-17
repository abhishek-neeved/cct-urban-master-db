import { Request, RequestHandler, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { BlockchainService } from './blockchain.service';
import { ListBlockchainsQuery } from './blockchain.validator';
import { asyncHandler } from '@middleware/async-handler';
import { success } from '@models/api-response';

export class BlockchainController {
  constructor(private readonly blockchainService: BlockchainService) {}

  list: RequestHandler = asyncHandler(async (req: Request, res: Response) => {
    const { search, chainType, page, limit } = req.query as unknown as ListBlockchainsQuery;
    const result = await this.blockchainService.list({ search, chainType, page, limit });
    res.status(StatusCodes.OK).json(success(result, req.id));
  });
}
