import dgram = require('dgram');
import { UdpSocket } from '../';

const port = parseInt(process.argv[2]) || 0;
const server = new UdpSocket(dgram.createSocket('udp4'), port);

server.onConnection = (socket, connInfo) => {
  console.log('New connection', socket.remote(), connInfo);
  socket.onMessage = (msg) => {
    console.log('Rx', msg);
    socket.send(msg);
  }

  socket.onClose = () => {
    console.log('Client closing', socket.address());
  }
}

server.onReady = (socket) => {
  socket.setBroadcast(true);
  console.log(`Server listening at port ${server.address().port} `);
  server.listen();
}

process.on('SIGINT', () => {
  server.close();
});

