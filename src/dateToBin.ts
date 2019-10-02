const DAY_MILLIS = 86500 * 1000;

export function numToBin(num: number, buffer: Uint8Array, offset: number = 0): Uint8Array {
  buffer[offset] = num & 0xff;
  buffer[offset + 1] = (num >>> 8) & 0xff;
  buffer[offset + 2] = (num >>> 16) & 0xff;
  buffer[offset + 3] = (num >>> 24) & 0xff;
  return buffer;
}

export function binToNum(buffer: Uint8Array, offset: number) {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  );
}

export function dateToBin(timestamp: number, buffer: Uint8Array, offset: number = 0): Uint8Array {
  const time = timestamp % DAY_MILLIS;
  const date = (timestamp - time) / DAY_MILLIS;

  numToBin(date, buffer, offset);
  numToBin(time, buffer, offset + 4);
  return buffer;
}

export function binToDate(buffer: Uint8Array, offset: number = 0) {
  const date = binToNum(buffer, offset);
  const time = binToNum(buffer, offset + 4);
  return (date * DAY_MILLIS) + time;
}
