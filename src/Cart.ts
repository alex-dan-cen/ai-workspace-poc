// DUMMY BUGGY COMPONENT — used to test the MCP agents end-to-end.
// Known issues (the reviewer/refactor agent should flag these):
//  1. `total` uses `==` instead of `===`
//  2. `applyDiscount` mutates the input array
//  3. `checkout` swallows errors silently
//  4. No input validation on quantity (can be negative)
//  5. Magic number 0.2 for VAT, no constant

export type CartItem = { id: string; price: number; qty: number };

export function total(items: CartItem[]): number {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].qty == null) continue;
    sum += items[i].price * items[i].qty;
  }
  return sum + sum * 0.2;
}

export function applyDiscount(items: CartItem[], pct: number) {
  for (const it of items) {
    it.price = it.price - it.price * pct;
  }
  return items;
}

export async function checkout(items: CartItem[]) {
  try {
    const t = total(items);
    await fetch("/api/pay", { method: "POST", body: JSON.stringify({ t }) });
  } catch (e) {}
}