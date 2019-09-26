import { Socket, RemoteInfo } from 'dgram';
import { decode, encode } from './TextEncoder';
import powmod from './powmod'

type AddressInfo = {
  address: string,
  port: number,
}

const CONNECT = 1;
const BCAST = 0;
const DATA = 2;
const CHUNK_SIZE = 1000;

const SERVER_SIDE_RETRIES = 20;
const CLIENT_SIDE_RETRIES = 5;

const MODE_CLIENT = 1;
const MODE_SERVER = 2;
const MODE_NONE = 0;
type Mode = 0 | 1 | 2;

const DIFFE_BASE = 46021;
const DIFFE_MODULO = 46147;
const ONE_BILLION = 1000000000;
const randomKey = () => ONE_BILLION + Math.floor(Math.random() * ONE_BILLION);

type ConnectionPayload = [
  /**
   * Public Key
   */
  number, // Public Key
  /**
   * Timestamp
   */
  number, //
  /**
   * Connection payload
   */
  any?
];

export class UDPSocket {
  private socket: Socket;
  private port: number;

  onError: (err: Error) => void;
  onReady: (socket: Socket) => void;
  onBroadCast: (msg: any, rInfo: AddressInfo) => void;
  // Return the version number
  onConnection: (socket: UDPSocket, payload: any) => void;
  onConnect: (address: AddressInfo, latency: number) => void;
  onMessage: (msg: any) => void;
  onClose: () => void;

  private onTerminate: () => void;

  private mode: Mode = MODE_NONE;
  private remoteAddress: AddressInfo;
  private seq: number;
  private ack: number;
  private retries: number;
  private privateKey: number;
  private sharedKey: number;
  private clients: {[address:string]: UDPSocket};

  private _try: number;
  private _txTimer: ReturnType<typeof setTimeout>;
  private txPending: [number, number, Uint8Array];
  private txQueue: Array<[number, number, Uint8Array]>;
  private rxBuffer: Uint8Array;
  private timeShift: number;

  constructor(socket: Socket, port?: number) {
    this.socket = socket;
    this.privateKey = randomKey();

    if (port !== null) {
      // setup port to listen for boardcast messages as well
      socket.bind(port, () => {
        const address = socket.address() as AddressInfo;
        // @ts-ignore
        this.port = address.port;
        socket.on('message', this.handleMessage);
        if (this.onReady) {
          this.onReady(socket);
        }
      });
    }
  }

  getTimeShift(): number {
    return this.timeShift;
  }

  remote(): AddressInfo {
    if (this.remoteAddress) return this.remoteAddress;
    return null;
  }

  address(): AddressInfo {
    if (this.socket) return this.socket.address() as AddressInfo;
    return null;
  }

  private _parse(data: Uint8Array) {
    if (!this.sharedKey) return;
    let i = 4;  // Never encrypt the header
    const b0 = this.sharedKey & 0xff;
    const b1 = (this.sharedKey >> 8) & 0xff;
    for (; i < data.length - 1; i += 2) {
      data[i] ^= b0;
      data[i + 1] ^= b1;
    }

    if (i < data.length) data[i] ^= b0;
  }

  terminate() {
    if (this.txPending) this._clearTransmit();
    this.txPending = null;
    this.rxBuffer = null;
    this.txQueue = null;

    // Clear the mode field flag
    this.mode = MODE_NONE;
    if (this.onTerminate) {
      this.onTerminate();
    } else {
      this.socket.close();
      this.socket = null;
    }

    if (this.onClose) this.onClose();
  }

  handleMessage = (data: Uint8Array, rinfo: RemoteInfo) => {
    const type = data[0];
    const remoteId = `${rinfo.address}:${rinfo.port}`;
    if (type === BCAST) {
      if (this.onBroadCast) {
        this.onBroadCast(this._parseBcast(data), rinfo);
      }
    } else if (type === CONNECT) {
      // Only allowed in Server mode
      if (this.mode === MODE_SERVER) {
        // close existing connection if any
        if (this.clients[remoteId]) {
          this.clients[remoteId].close();
        }
        const payload = this._parseConnect(data);
        const sock = new UDPSocket(this.socket, null);
        sock.timeShift = Date.now() - payload[1];
        sock.init(rinfo, SERVER_SIDE_RETRIES, payload[0]);
        sock.onTerminate = () => {
          delete this.clients[remoteId];
        }
        const publicKey = powmod(DIFFE_BASE, this.privateKey, DIFFE_MODULO);
        const buf = this._prepareConnect([publicKey, Date.now()]);
        sock._send(buf, 0, buf.length, rinfo.port, rinfo.address);
        this.clients[remoteId] = sock;
        this.onConnection(sock, payload[2]);
      } else if (this.mode === MODE_CLIENT) {
        const payload = this._parseConnect(data);
        this.init(rinfo, CLIENT_SIDE_RETRIES, payload[0]);
        this.timeShift = Date.now() - payload[1];
        if (this.onConnect) this.onConnect(rinfo, this.timeShift);
      }
    } else if (type === DATA) {
      if (this.mode === MODE_CLIENT) {
        this.handleData(data);
      } else if (this.mode === MODE_SERVER) {
        const sock = this.clients[remoteId];
        if (sock) {
          sock.handleData(data);
        }
      }
    }
  }

  private init(rinfo: AddressInfo, retries: number, publicKey: number) {
    this.mode = MODE_CLIENT;
    this.remoteAddress = rinfo;
    this.seq = 0;
    this.ack = 0;
    this.sharedKey = powmod(publicKey, this.privateKey, DIFFE_MODULO);
    this.retries = retries;
    this.rxBuffer = null;
    this.txQueue = [];
    this.txPending = null;
  }

  close() {
    if (this.mode === MODE_SERVER) {
      // Close all client sockets
      Object.values(this.clients).forEach(client => client.close());

      // Close the underlying udp socket
      this.socket.close();
    } else if (this.mode === MODE_CLIENT) {
      this.terminate();
    } else if (this.socket) {
      this.socket.close();
    }
  }

  clone() {
    // Use this method to forward socket from one UDPSocket shell to another
    if (this.mode !== MODE_NONE) throw new Error('Can only clone an uninitialized socket. Client/Server sockets cannot be cloned');
    const clone = new UDPSocket(this.socket, null);
    // @ts-ignore
    this.socket = null;
    return clone;
  }

  listen() {
    if (this.mode !== MODE_NONE) throw new Error('Invalid socket mode. Cannot change a client socket to server');
    if (!this.onConnection) throw new Error('Listening sockets must provide onConnection handler');
    this.mode = MODE_SERVER;
    this.clients = {};
  }

  connect(address: AddressInfo, payload: any) {
    if (this.mode !== MODE_NONE) throw new Error('Invalid socket mode. Cannot change a server socket to a client');
    this.mode = MODE_CLIENT;
    this.remoteAddress = address;
    this.privateKey = randomKey();
    this.onTerminate = () => {
      this.socket.close();
    }

    const publicKey = powmod(DIFFE_BASE, this.privateKey, DIFFE_MODULO);
    const buf = this._prepareConnect([publicKey, Date.now(), payload]);
    this._send(buf, 0, buf.length, address.port, address.address);
  }

  broadcast(msg: any, address?: string) {
    const buf = this._prepareBcast(msg);
    this._send(buf, 0, buf.length, this.port, address);
  }

  private handleData(data: Uint8Array) {
    const remoteSeq = data[1];
    const remoteAck = data[2];
    const chunk = data[3];

    let trySend = false;
    // Use the acknowledgement
    if (remoteAck === this.seq % 256) {
      // Remove the last send data from the queue
      this._clearTransmit();
      trySend = this.txQueue.length > 0;
    }

    if (remoteSeq === (this.ack + 1) % 256) {
      // Accept data in sequence
      this.ack = remoteSeq;
      // Looks like we got something to process
      if (!this.rxBuffer) {
        this.rxBuffer = data;
      } else {
        // Append data to the rxBuffer
        const newBuf = new Uint8Array(this.rxBuffer.length + data.length - 4);
        newBuf.set(data, newBuf.length - data.length);
        newBuf.set(this.rxBuffer);
        this.rxBuffer = newBuf;
      }

      // Keep the data in the rx buffer
      if (chunk === 0) {
        const payload = this._parseData(this.rxBuffer);
        this.rxBuffer = null;
        this.onMessage(payload);
      }

      trySend = true;
    }

    // Send an ack with a packet if available
    if (trySend) this._trySend();
  }

  private _parseData(buf: Uint8Array): any {
    const header = '["",';
    buf[0] = header.charCodeAt(0);
    buf[1] = header.charCodeAt(1);
    buf[2] = header.charCodeAt(2);
    buf[3] = header.charCodeAt(3);
    const msg = JSON.parse(decode(buf));
    return msg[1];
  }

  send(payload: any) {
    if (this.mode !== MODE_CLIENT) throw new Error('Socket is not a client and cannot send messages');
    // Create chunks and queue them
    // Add extra space for headers `["",` 4 bytes
    const msg = encode(JSON.stringify(["", payload]));
    const trySend = this.txQueue.length === 0 && !this.txPending;

    // Divide it into chunks of little less than 1000 bytes
    let chunks = Math.floor((msg.length - 1) / CHUNK_SIZE) + 1;
    if (chunks > 256) throw new Error(`Payload can at max be ${CHUNK_SIZE * 256} bytes. Your payload is ${msg.length} bytes`);
    let offset = 4; // Start offset with the header
    do {
      chunks -= 1;
      this.txQueue.push([chunks, offset, msg]);
      offset += CHUNK_SIZE;
    } while (chunks > 0);

    if (trySend) this._trySend();
    // this._send(, payload, this.remoteAddress.port, this.remoteAddress.address);
  }

  private _clearTransmit() {
    clearTimeout(this._txTimer);
    this.txPending = null;
  }

  private _unitTransmit = () => {
    this._try += 1;
    if (this._try > this.retries) {
      // number of retries exceeded, we couldn't send something
      this.close();
      return;
    }

    const [chunk, offset, msg] = this.txPending;
    msg[offset - 4] = DATA;
    msg[offset - 3] = this.seq;
    msg[offset - 2] = this.ack;
    msg[offset - 1] = chunk;

    this._send(msg, offset - 4, Math.min(msg.length - offset, CHUNK_SIZE) + 4, this.remoteAddress.port, this.remoteAddress.address);

    // retry almost immediately
    this._txTimer = setTimeout(this._unitTransmit, 300);
  }

  private _trySend() {
    if (this.txQueue.length === 0 || this.txPending) {
      const emptyAck = new Uint8Array(4);
      emptyAck[0] = DATA;
      emptyAck[1] = this.seq % 256;
      emptyAck[2] = this.ack % 256;
      emptyAck[3] = 0;
      this._send(emptyAck, 0, 4, this.remoteAddress.port, this.remoteAddress.address);
    } else if (!this.txPending) {
      this._try = 0;
      this.txPending = this.txQueue.shift();
      this.seq = (this.seq + 1) % 256;
      this._unitTransmit();
    }
  }

  private _prepareConnect(payload: ConnectionPayload) {
    const msg = JSON.stringify(payload);
    const buf = encode(msg);
    // Replace the starting '[' with the connect code
    buf[0] = CONNECT;
    return buf;
  }

  private _parseConnect(buf: Uint8Array): ConnectionPayload {
    buf[0] = '['.charCodeAt(0);
    return JSON.parse(decode(buf));
  }

  private _prepareBcast(payload: any) {
    const msg = JSON.stringify(payload);
    const buf = encode(` ${msg}`);
    // Replace the starting space with bcast code
    buf[0] = BCAST;
    return buf;
  }

  private _parseBcast(buf: Uint8Array) {
    buf[0] = 32;
    return JSON.parse(decode(buf));
  }

  private _send(buf: Uint8Array, offset: number, length: number, port: number, ip: string = '255.255.255.255') {
    // xor with the shared key
    // this._parse(buf);
    this.socket.send(buf, offset, length, port, ip);
  }
}
