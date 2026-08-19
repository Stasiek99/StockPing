import express, { type Request, type Response, type NextFunction } from 'express';
import { listProducts, setStock } from './products';

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/products', (_req: Request, res: Response) => {
    res.status(200).json(listProducts());
  });

  app.patch('/products/:id/stock', (req: Request<{ id: string }>, res: Response) => {
    const { stock } = req.body ?? {};

    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
      res.status(400).json({ message: 'stock must be a non-negative integer' });
      return;
    }

    const product = setStock(req.params.id, stock);
    if (!product) {
      res.status(404).json({ message: `Product ${req.params.id} not found` });
      return;
    }

    res.status(200).json(product);
  });

  // express.json() throws a SyntaxError for malformed bodies before it reaches any handler.
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ message: 'Request body must be valid JSON' });
      return;
    }
    next(err);
  });

  return app;
}
