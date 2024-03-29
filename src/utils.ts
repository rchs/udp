import { strToUint8, uint8ToStr } from './strToUint8';
const RETRY_INTERVAL = 500;

// Maximum chunksize (limited by android devices)
const CHUNK_SIZE = 980;
const HEADER_SPACE = ' '.repeat(10); // Total Header would be SPACE + 4 bytes
export function createPayload(data: any) {
  return strToUint8(JSON.stringify([HEADER_SPACE, data]));
}
const HEADER = strToUint8(`["${HEADER_SPACE}",`);
const BLANK = strToUint8(JSON.stringify([HEADER_SPACE, null]));

export function parsePayload(payload: Uint8Array) {
  payload.set(HEADER);
  return JSON.parse(uint8ToStr(payload))[1];
}

export class RxBuffer {
  private buffer: Uint8Array;

  append(chunk: number, buffer: Uint8Array): any {
    let buf = buffer;
    if (this.buffer) {
      buf = new Uint8Array(this.buffer.length + buffer.length - HEADER.length);
      buf.set(buffer, buf.length - HEADER.length);
      buf.set(this.buffer);
      this.buffer = undefined;
    } else {
      buf.set(HEADER);
    }

    if (chunk === 0) return JSON.parse(uint8ToStr(buf))[1];
    this.buffer = buf;
  }

  clear() {
    this.buffer = undefined;
  }
}

export class TxQueue {
  private queue: Array<[number, Uint8Array, number, number, number, boolean]> = [];
  private handle: ReturnType<typeof setTimeout> = null;
  tries: number = 0;
  private readonly sender: () => void;

  constructor(sender: () => void) {
    this.sender = sender;
  }

  pop() {
    if (!this.handle) {
      return null;
    }

    clearTimeout(this.handle);
    this.tries = 0;
    this.handle = null;
    return this.queue.shift()[0];
  }

  isEmpty() {
    return this.queue.length === 0;
  }

  peek() {
    const v = this.queue[0];
    if (v[5] === true) {
      this.tries = 0;
      this.queue.shift();
    }
    return v;
  }

  add(type: number, data: any) {
    const payload = createPayload(data);
    // Divide paylaod into multiple chunks if needed
    let chunks = Math.floor((payload.length - 1) / CHUNK_SIZE) + 1;
    if (chunks > 256) throw new Error(`Payload can be at max be ${CHUNK_SIZE * 256} bytes. Your payload is ${payload.length} bytes including headers`);
    let offset = 0; // Start offset with the header
    do {
      chunks -= 1;
      this.queue.push([
        type,
        payload,
        chunks,
        offset,
        chunks === 0 ? (payload.length - offset) : (CHUNK_SIZE + HEADER.length),
        false,
      ]);
      offset += CHUNK_SIZE;
    } while (chunks > 0);
  }

  activate(type: number) {
    if (!this.handle && this.queue.length === 0) {
      this.queue.push([type, BLANK, 0, 0, BLANK.length, true]);
    }
  }

  try() {
    if (this.handle || this.queue.length === 0) return;
    // Try to send
    this.sender();
  }

  setupRetry() {
    this.handle = setTimeout(this.sender, RETRY_INTERVAL + Math.random() * 50);
  }

  abort() {
    if (this.handle) {
      clearTimeout(this.handle);
      this.handle = null;
    }
    this.queue.length = 0;
  }
}