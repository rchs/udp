import { strToUint8, uint8ToStr } from '../src';

test('strToUint8 spec', () => {
  const txt = 'Hello World 1234 रञ्जन श्रेष्ठ ﰀ ﬡ ﬗ check';
  const b = strToUint8(txt);
  const res = uint8ToStr(b);
  expect(res).toBe(txt);
});
