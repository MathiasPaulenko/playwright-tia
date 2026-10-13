export interface CartItem {
  id: string;
  qty: number;
}

const items: CartItem[] = [];

export function addItem(id: string): CartItem[] {
  const found = items.find((i) => i.id === id);
  if (found) {
    found.qty += 1;
  } else {
    items.push({ id, qty: 1 });
  }
  return items.map((i) => ({ ...i }));
}

export function cartTotal(): number {
  return items.reduce((total, item) => total + item.qty, 0);
}
