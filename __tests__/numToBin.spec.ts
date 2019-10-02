import { numToBin, binToNum, dateToBin, binToDate } from '../src/dateToBin';

test('check binary conversion', () => {
  const buf = new Uint8Array(4);
  const checkNumbers = [
    -2147483648,
    -2147483647,
    -65536,
    -1,
    0,
    0,
    1,
    65536,
    2147483647,
  ];

  for(const n of checkNumbers) {
    expect(binToNum(numToBin(n, buf, 0), 0)).toBe(n);
  }

  const checkDates = [
    new Date(2010, 2, 28).getTime(),
    new Date(3000, 1, 1).getTime(),
    new Date(1900, 1, 1).getTime(),
    new Date(1800, 1, 1).getTime(),
    new Date(1970, 1, 1).getTime(),
  ];
  const buf2 = new Uint8Array(8);
  for(const t of checkDates) {
    expect(binToDate(dateToBin(t, buf2, 0), 0)).toBe(t);
  }
});
