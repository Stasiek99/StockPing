export interface Watch {
  productId: string;
  createdAt: string;
  notified: boolean;
}

export function watchKey(userId: string, productId: string) {
  return {
    PK: `USER#${userId}`,
    SK: `WATCH#${productId}`,
  };
}
