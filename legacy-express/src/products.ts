export interface Product {
  id: string;
  name: string;
  stock: number;
}

// In-memory store standing in for a legacy warehouse system's product table.
// Reset on every process restart — this service is intentionally stateless across deploys.
const products: Product[] = [
  { id: '1', name: 'Mechanical Keyboard', stock: 0 },
  { id: '2', name: 'Ultrawide Monitor', stock: 3 },
  { id: '3', name: 'USB-C Dock', stock: 0 },
];

export function listProducts(): Product[] {
  return products;
}

export function findProduct(id: string): Product | undefined {
  return products.find((product) => product.id === id);
}

export function setStock(id: string, stock: number): Product | undefined {
  const product = findProduct(id);
  if (!product) {
    return undefined;
  }
  product.stock = stock;
  return product;
}
