import dgram = require('dgram');
import{ UDPSocket } from '../';

const SERVER = process.argv[2];
const SERVER_PORT = parseInt(process.argv[3]);
const CLIENT_PORT = parseInt(process.argv[4]) || 0;

if (!SERVER || !SERVER_PORT) {
  console.log('Provider server address and port as cli arguments');
} else {
  const client = new UDPSocket(dgram.createSocket('udp4'), CLIENT_PORT);
  client.onReady = () => {
    console.log(`Client is ready at ${client.address().port} connecting to udp://${SERVER}:${SERVER_PORT}`);
    client.connect({ address: SERVER, port: SERVER_PORT }, 'Demo Client');
  }

  client.onConnect = (payload) => {
    console.log(`Connected with server with timeshift ${client.getTimeShift()} - payload`, payload);
    client.send('Hello');
  }

  client.onMessage = (msg) => {
    console.log('Rx', msg);
  }

  client.onClose = () => {
    console.log('Closed');
  }

  process.on('SIGINT', () => {
    client.close();
  });
}


