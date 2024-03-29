import dgram = require('dgram');
import { UDPSocket } from '../';

const port = parseInt(process.argv[2]) || 0;
const server = new UDPSocket(dgram.createSocket('udp4'), port);
server.onError = (err) => {
  console.log('Error', err);
}
server.onInit = (payload) => {
  return [payload, 'from-server'];
}

server.onConnection = (socket, connInfo) => {
  console.log(`New connection: TimeShift ${socket.getTimeShift()}`, socket.remote(), connInfo);
  socket.onMessage = (msg) => {
    console.log('Rx', msg);
    socket.send(`Echo ${msg}`);
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
  console.log(`kill -9 ${process.pid}`);
  server.close();
  // process.exit();
});

