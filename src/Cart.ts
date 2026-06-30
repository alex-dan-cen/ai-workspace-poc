export type CartItem = { id: string; price: number; qty: number };

const VAT_RATE = 0.2;

export function total(items: CartItem[]): number {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].qty === null || items[i].qty < 0) continue; // Fix 1: Use === and validate quantity
    sum += items[i].price * items[i].qty;
  }
  return sum + sum * VAT_RATE; // Fix 5: Use VAT_RATE constant
}

export function applyDiscount(items: CartItem[], pct: number) {
  const discountedItems = items.map(item => ({ ...item })); // Fix 2: Don't mutate input array
  for (const it of discountedItems) {
    it.price = it.price - it.price * pct;
  }
  return discountedItems;
}

export async function checkout(items: CartItem[]) {
  try {
    const t = total(items);
    await fetch("/api/pay", { method: "POST", body: JSON.stringify({ t }) });
  } catch (e) {
    console.error("Checkout error:", e); // Fix 3: Don't swallow errors silently
    throw e; // Re-throw the error for better error handling upstream
  }
}