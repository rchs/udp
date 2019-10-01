import { Socket, RemoteInfo } from 'dgram';
import { RxBuffer, TxQueue, parsePayload, createPayload } from './utils';

/**
 * Packet format
 * Byte 0: Version
 * Byte 1: packet Type
 *    0: Broadcast
 *    1: Open
 *    2: Payload
 *    3: Close
 * Byte 2: Seq Number
 * Byte 3: Ack Number
 * Byte 4: Chunk Number
 */

type AddressInfo = {
  address: string,
  port: number,
}

const VERSION = 1;
const MAX_TRIES = 3;

const STATE_NONE = 0;
const STATE_LISTENING = 1;
const STATE_CONNECTING = 2;
const STATE_CONNECTED = 3;
const STATE_CLOSING = 4;
type State = 0 | 1 | 2 | 3 | 4;

const MSG_BCAST = 0x00;
const MSG_DATA = 0x80;
const MSG_CONNECT = MSG_DATA | 0x01;
const MSG_MESSAGE = MSG_DATA | 0x02;
const MSG_CLOSE = MSG_DATA | 0x04;

const CODE_NO_RESPONSE = 1;
const CODE_NORMAL = 0;

function incr(num: number) {
  return (num + 1) % 256;
}

export class UDPSocket {
  // the underlying socket instance. It is set to null once the socket is terminated
  private socket: Socket = null;

  // the port to which the socket is bound. Until the udp socket is bound to any specific
  // port, it is zero
  private port: number = 0;

  // The mode on which this socket is
  private state: State = STATE_NONE;

  onError: (err: Error) => void;
  onReady: (socket: Socket) => void;
  onBroadcast: (msg: any, rInfo: AddressInfo, version: number) => void;
  // Return the version number
  onInit: (payload: any) => any;
  onConnection: (socket: UDPSocket, payload: any, initPayload: any) => void;
  onConnect: (initPayload: any) => void;
  onMessage: (msg: any) => void;
  onClose: (code: number) => void;

  private clients: {[address:string]: UDPSocket};

  private remoteAddress: AddressInfo;
  private version: number;
  private seq: number;
  private ack: number;
  private rx: RxBuffer;
  private tx: TxQueue;
  private timeShift: number;
  private _onTerminate: (code: number) => void;

  constructor(socket: Socket, port?: number) {
    this.socket = socket;

    if (port !== null) {
      // setup port to listen for boardcast messages as well
      socket.on('error', (err) => {
        if (this.onError) this.onError(err);
      });

      socket.bind(port, () => {
        const address = socket.address() as AddressInfo;
        this.port = address.port;
        // Attach the message handler
        socket.on('message', this._handleMessage);
        if (this.onReady) this.onReady(socket);
      });
    }
  }

  listen() {
    if (this.state !== STATE_NONE) throw new Error('Invalid socket mode. Cannot change a client socket to server');
    if (!this.onConnection) throw new Error('Listening sockets must provide onConnection handler');
    this.state = STATE_LISTENING;
    this.clients = {};
  }

  /**
   * Connect to the remote server with the connection payload, most likely for verification. It
   * triggers onInit on remote server with the given payload.
   *
   * @param to { address, port }
   * @param token any token that is passed as is to the server. Make sure it doesn't cross
   *              the 1000 bytes UDP packet limit.
   */
  connect(to: AddressInfo, token: any) {
    if (this.state !== STATE_NONE) throw new Error('Invalid socket mode. Cannot change a server socket to a client');
    this._init(to, VERSION);
    this._terminate = () => {
      this.socket.close();
      this.socket = null;
    }
    this.state = STATE_CONNECTING;
    this.remoteAddress = to;
    this.tx.add(MSG_CONNECT, [Date.now(), token]);
    this.tx.try();
  }

  broadcast(message: any, address: string = '255.255.255.255') {
    this._send(MSG_BCAST, this.port, address, createPayload(message));
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

  private _handleMessage = (data: Uint8Array, rInfo: RemoteInfo) => {
    const type = data[0];
    const version = data[1];

    // Handle broadcast separately
    if (type === MSG_BCAST) {
      // Replace with the valid json characters
      if (this.onBroadcast) this.onBroadcast(parsePayload(data), rInfo, version);
      return;
    }

    if (this.state !== STATE_LISTENING) {
      this._processData(data, rInfo);
    } else {
      const remoteId = `${rInfo.address}:${rInfo.port}`;
      const client = this.clients[remoteId];
      if (client) {
        client._processData(data, rInfo);
      } else if (type === MSG_CONNECT) {
        const payload = parsePayload(data);
        const connPayload = this.onInit ? this.onInit(payload) : null;
        const newClient = new UDPSocket(this.socket, null);
        this.clients[remoteId] = newClient;
        newClient._init(rInfo, version);
        newClient.seq = 1;
        newClient._onTerminate = (code: number) => {
          delete this.clients[remoteId];
          newClient.socket = null;
          if (this.state === STATE_CLOSING) {
            if (Object.keys(this.clients).length === 0) {
              this.state = STATE_NONE;
              this.socket.close();
              this.socket = null;
              this.onClose(CODE_NORMAL);
            }
          }
        }
        newClient.tx.add(MSG_CONNECT, connPayload);
        newClient.tx.try();
        // Try to initialize the client
        this.onConnection(newClient, payload, connPayload);
      }
    }
  }

  private _processData(data: Uint8Array, rInfo: RemoteInfo) {
    const type = data[0];
    const version = data[1];
    const ack = data[2];
    const seq = data[3];

    if (ack === this.seq) {
      // We got ourselves an acknowledgement for the sent data
      // Clear pending tx
      this.seq = incr(this.seq);
      const type = this.tx.pop();

      // We got acknowledgement for our close, it's time for termination
      if (type === MSG_CLOSE) {
        this._terminate(CODE_NORMAL);
      }
    }

    if (seq === incr(this.ack)) {
      // We got some data to process
      this.ack = seq;
      const payload = this.rx.append(data);
      if (payload !== undefined) {
        if (type === MSG_DATA) {
          this.onMessage(payload);
          this.tx.activate(MSG_DATA);
        } else if (type === MSG_CONNECT) {
          this.onConnect(payload);
          this.tx.activate(MSG_DATA);
        } else if (type === MSG_CLOSE) {
          this.close(payload);
        }
      }
    }

    this.tx.try();
  }

  private _terminate(code: number) {
    // Make sure we release all the resources
    this.tx.abort();
    this.rx.clear();

    if (this._onTerminate) this._onTerminate(code);
    if (this.onClose) this.onClose(code);
  }

  private _init(rinfo: AddressInfo, version: number) {
    this.state = STATE_CONNECTED;
    this.remoteAddress = rinfo;
    this.seq = 0;
    this.ack = 0;
    this.version = version < VERSION ? version : VERSION;
    this.rx = new RxBuffer();

    this.tx = new TxQueue(() => {
      this.tx.tries += 1;
      if (this.tx.tries >= MAX_TRIES) {
        return this._terminate(CODE_NO_RESPONSE);
      }

      const [type, buffer, chunk, offset, length, isEmpty] = this.tx.peek();
      this._send(type, this.remoteAddress.port, this.remoteAddress.address, buffer, offset, length, chunk, isEmpty);
    });
  }

  close(reason: number = 0) {
    if (this.state === STATE_CLOSING) {
      return;
    }

    if (this.state === STATE_LISTENING) {
      this.state = STATE_CLOSING;
      const clients = Object.values(this.clients);
      if (clients.length === 0) {
        this.socket.close();
        this.socket = null;
        if (this.onClose) this.onClose(reason);
      } else {
        clients.forEach(client => client.close());
      }
    } else {
      this.state = STATE_CLOSING;
      this.tx.add(MSG_CLOSE, reason);
      this.tx.try();
    }
  }

  clone() {
    // Use this method to forward socket from one UDPSocket shell to another
    if (this.state !== STATE_NONE) throw new Error('Can only clone an uninitialized socket. Client/Server sockets cannot be cloned');
    this.socket.removeListener('message', this._handleMessage);
    const clone = new UDPSocket(this.socket, null);
    clone.port = this.port;
    clone.socket.on('message', clone._handleMessage);
    this.socket = null;
    return clone;
  }

  send(data: any) {
    if (this.state !== STATE_CONNECTED) {
      console.warn('Socket is not connected. Data will not be sent');
    } else {
      this.tx.add(MSG_MESSAGE, data);
      this.tx.try();
    }
  }

  private _send(type: number, port: number, ip: string, buf: Uint8Array, offset: number = 0, length: number = buf.length, chunk: number = 0, isEmpty: boolean = false) {
    buf[0] = type;
    buf[1] = this.version;
    buf[2] = isEmpty ? this.seq : incr(this.seq);
    buf[3] = this.ack;
    buf[4] = chunk;

    this.socket.send(buf, offset, length, port, ip);
  }
}
