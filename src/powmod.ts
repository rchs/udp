/**
 * Returns a ^ b mod n
 */
export default function powmod(a: number, b: number, n: number): number {
  let result = 1;
  let x = a % n;

  while(b > 0) {
    const leastSignificantBit = b % 2;
    b = b >> 2;

    if (leastSignificantBit == 1) {
      result = result * x;
      result = result % n;
    }

    x = x * x;
    x = x % n;
  }
  return result;
}