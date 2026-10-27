export const SERVICE_UUID = 'd39b0001-96f8-4ed4-9b8c-bb981c31b001';
export const DATA_UUID = 'd39b0002-96f8-4ed4-9b8c-bb981c31b001';

export function decodePacket(value) {
  if (!(value instanceof DataView) || value.byteLength !== 18) throw new Error('센서 패킷 길이가 다릅니다. INO와 웹사이트 버전을 확인하세요.');
  if (value.getUint8(0) !== 1 || value.getUint8(1) > 2) throw new Error('지원하지 않는 센서 데이터입니다.');
  const front = value.getUint16(8, true), rear = value.getUint16(10, true);
  const roll = value.getInt16(12, true) / 100, pitch = value.getInt16(14, true) / 100, yaw = value.getInt16(16, true) / 100;
  if (front > 4095 || rear > 4095 || Math.abs(roll) > 180 || Math.abs(pitch) > 90 || Math.abs(yaw) > 180) throw new Error('센서 데이터 범위를 확인하세요.');
  return { status: value.getUint8(1), sequence: value.getUint16(2, true), uptime: value.getUint32(4, true), front, rear, roll, pitch, yaw };
}
