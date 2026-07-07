import request from 'supertest';
import { createApp } from '../src/app';

const app = createApp();

describe('GET /products', () => {
  test('returns the seeded product list', async () => {
    const res = await request(app).get('/products');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), stock: expect.any(Number) });
  });
});

describe('PATCH /products/:id/stock', () => {
  test('updates stock and returns the updated product', async () => {
    const res = await request(app).patch('/products/2/stock').send({ stock: 10 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: '2', stock: 10 });
  });

  test('rejects a negative stock value', async () => {
    const res = await request(app).patch('/products/2/stock').send({ stock: -1 });

    expect(res.status).toBe(400);
  });

  test('rejects a non-integer stock value', async () => {
    const res = await request(app).patch('/products/2/stock').send({ stock: 1.5 });

    expect(res.status).toBe(400);
  });

  test('rejects a missing stock field', async () => {
    const res = await request(app).patch('/products/2/stock').send({});

    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown product id', async () => {
    const res = await request(app).patch('/products/does-not-exist/stock').send({ stock: 5 });

    expect(res.status).toBe(404);
  });

  test('rejects a malformed JSON body with 400', async () => {
    const res = await request(app)
      .patch('/products/2/stock')
      .set('Content-Type', 'application/json')
      .send('{not-json');

    expect(res.status).toBe(400);
  });
});
