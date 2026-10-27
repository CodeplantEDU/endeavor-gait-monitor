import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePacket } from '../dist/protocol.mjs';

function packet() {
  const value = new DataView(new ArrayBuffer(18));
  value.setUint8(0, 1); value.setUint8(1, 2);
  value.setUint16(2, 65535, true); value.setUint32(4, 0xffffffff, true);
  value.setUint16(8, 1234, true); value.setUint16(10, 4095, true);
  value.setInt16(12, -1234, true); value.setInt16(14, 9000, true); value.setInt16(16, -18000, true);
  return value;
}
test('front/rear mapping, signed degrees, sequence and uptime wrap boundaries', () => {
  assert.deepEqual(decodePacket(packet()), {status: 2, sequence: 65535, uptime: 0xffffffff, front: 1234, rear: 4095, roll: -12.34, pitch: 90, yaw: -180});
});
test('reject truncated, oversized and unsupported packets', () => {
  for (const n of [0, 17, 19, 20]) assert.throws(() => decodePacket(new DataView(new ArrayBuffer(n))));
  const v = packet(); v.setUint8(0, 2); assert.throws(() => decodePacket(v));
  v.setUint8(0, 1); v.setUint8(1, 3); assert.throws(() => decodePacket(v));
});
test('reject out-of-range ADC and angles', () => {
  for (const [offset, number] of [[8, 4096], [10, 4096], [12, 18001], [14, 9001], [16, -18001]]) {
    const v = packet(); v.setInt16(offset, number, true); assert.throws(() => decodePacket(v));
  }
});
test('MPU failure / calibration preserve independent FSR readings', () => {
  for (const status of [0, 1]) { const v = packet(); v.setUint8(1, status); assert.equal(decodePacket(v).front, 1234); }
});
