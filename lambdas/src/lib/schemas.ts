import { z } from 'zod';

const productId = z.string().trim().min(1, 'productId is required').max(200, 'productId is too long');

export const createWatchBodySchema = z.object({
  productId,
});

export const deleteWatchParamsSchema = z.object({
  productId,
});
