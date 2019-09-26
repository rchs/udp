import dgram = require('dgram');
import { UDPSocket } from '../';

const socket = dgram.createSocket('udp4');
const serverPort = 17812;
const server = new UDPSocket(socket, serverPort);

server.onReady = (socket) => {
  socket.setBroadcast(true);
  console.log('Server', socket.address());

  server.bcast('Hello from Server');
}

let start = 0;
server.listen();
server.onConnection = (socket, payload) => {
  console.log('New connection', socket.remote(), payload);
  socket.onMessage = (msg) => {
    console.log('Rx ', msg.length);
  }

  socket.onClose = () => {
    console.log('Server sock closing');
    server.close();
  }

  start = Date.now();
  console.log(Date.now(), 'Sent timestamp');
  const data = 'A'.repeat(973);
  for (let i = 0; i < 1; i += 1) {
    socket.send(data);
  }
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // socket.send('Long Message from server'.repeat(10408));
  // return version - 1;
}

const client = new UDPSocket(dgram.createSocket('udp4'))
client.onReady = (socket) => {
  console.log('Client', socket.address());
  socket.setBroadcast(true);

  client.bcast('Hello from Client');
}

server.onBroadCast = (msg) => {
  console.log('Server bcast rx', msg);
}

client.onBroadCast = (msg) => {
  console.log('Client bcast rx', msg);
};

client.onConnect = (serverAddress, latency) => {
  console.log(`Connected with ${serverAddress.address} with latency ${latency}`);
  client.send('A Long Message'.repeat(200));
};

client.onClose = () => {
  console.log('Client is closing');
}

let total = 0;
let interval = 0;
let speed = 0;
client.onMessage = (msg: string) => {
  total += msg.length;
  interval = Date.now() - start;
  speed = ((total * 1000) / interval) / 1024 / 1024;
  // console.log(Date.now(), 'Message', msg.length);
}


setTimeout(() => {
  client.connect({ address: 'localhost', port: serverPort }, {
    version: 5,
    id: 'cl',
    name: 'Demo Client',
  });
}, 500);

process.on('SIGINT', () => {
  console.log(`Total:`, total, Date.now() - start, `${speed} MB/s`);

  console.log('Stopping Demo UDP Server');
  client.close();
  server.close();
});
