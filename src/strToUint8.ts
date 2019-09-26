/**
 * Simple mechanism to convert the javascript string to a
 * Uint8 array (byte array) for transmission over UDP or
 * other channels.
 *
 * The algorithm uses the following mechanisms
 * 1. USE MSB sequence to determine size
 *      a. If the MSB of a byte is not set then use the next 7
 *         bits to represent the code point
 *      b. If the next to MSB is not set, then use the next 14
 *         bits to represent the code point
 *      c. If the 3rd to MSB is not set, then use the next 21
 *         bits to represent the code point
 *      d. This makes all UNICODE text representable within 3
 *         bytes
 * 2. XOR the code points one after another, which results in
 *    a values which is generally smaller than 128 becuase in
 *    common usage we tend to use the same characters from same
 *    language in sequence.
 */
const seed = 0x55;

export function uint8ToStr(buf: Uint8Array): string {
  const numbers = [];
  let i = 0;
  let prev = seed;
  do {
    let value = buf[i++];
    // If the first bit is not set
    if ((value & 0x80) === 0) {
    } else if ((value & 0x40) === 0) {
      value = ((value & 0x3f) << 8) | buf[i++];
    } else {
      value = ((value & 0x1f) << 16) |  (buf[i++] << 8) | buf[i++];
    }
    prev = value ^ prev;
    numbers.push(prev)
  } while (i < buf.length);

  return String.fromCodePoint.apply(null, numbers);
}

export function strToUint8(str: string): Uint8Array {
  if (!str) return new Uint8Array(0);

  const values = [];
  let prev = seed;
  for (let i = 0; i < str.length; i += 1) {
    const code = str.codePointAt(i);
    const value = prev ^ code;
    if (value < 0x80) { // 7 bit values as it is
      values.push(value);
    } else if (value < 0x4000) { // 14 bit values
      values.push(0x80 | (value >> 8));
      values.push(0xff & value);
    } else {
      values.push(0xc0 | (value >> 16));
      values.push(0xff & (value >> 8));
      values.push(0xff & value);
    }
    prev = code;
  }


  return new Uint8Array(values);
}
