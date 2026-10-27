#include <Arduino.h>
#include <Wire.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <atomic>
#include "OrientationFilter.h"

#if !defined(CONFIG_IDF_TARGET_ESP32)
#error "This pin map requires the original ESP32 (e.g. ESP32 Dev Module / WROOM-32)."
#endif

constexpr uint8_t FSR_FRONT = 35, FSR_REAR = 34;
constexpr uint8_t MPU6500_ID = 0x70;
constexpr char SERVICE_UUID[] = "d39b0001-96f8-4ed4-9b8c-bb981c31b001";
constexpr char DATA_UUID[] = "d39b0002-96f8-4ed4-9b8c-bb981c31b001";
enum ImuStatus : uint8_t { IMU_ERROR = 0, CALIBRATING = 1, READY = 2 };

struct __attribute__((packed)) SensorPacket {
  uint8_t version = 1, imuStatus = IMU_ERROR;
  uint16_t sequence = 0;
  uint32_t uptimeMs = 0;
  uint16_t front = 0, rear = 0;
  int16_t roll = 0, pitch = 0, yaw = 0; // degrees * 100, little endian
};
static_assert(sizeof(SensorPacket) == 18, "BLE packet layout changed");

BLECharacteristic *dataCharacteristic;
std::atomic<bool> connected{false}, advertiseAgain{false};
SensorPacket packet;
OrientationFilter orientation;
uint8_t mpuAddress = 0x68;
float ax, ay, az, gx, gy, gz, biasX = 0, biasY = 0, biasZ = 0;
uint32_t lastPublish = 0, lastSample = 0, lastAttempt = 0;

class ConnectionCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { connected = true; }
  void onDisconnect(BLEServer *) override { connected = false; advertiseAgain = true; }
};

void publish() {
  if (uint32_t(millis() - lastPublish) < 50) return;
  lastPublish = millis();
  packet.uptimeMs = lastPublish;
  packet.front = analogRead(FSR_FRONT);
  packet.rear = analogRead(FSR_REAR);
  ++packet.sequence;
  if (packet.imuStatus == READY) {
    packet.roll = lroundf(orientation.roll() * 100);
    packet.pitch = lroundf(orientation.pitch() * 100);
    packet.yaw = lroundf(orientation.yaw() * 100);
  } else {
    packet.roll = packet.pitch = packet.yaw = 0;
  }
  dataCharacteristic->setValue(reinterpret_cast<uint8_t *>(&packet), sizeof(packet));
  if (connected) dataCharacteristic->notify();
}

const char *i2cResult(uint8_t code) {
  switch (code) {
    case 0: return "ACK";
    case 1: return "TX buffer overflow";
    case 2: return "NACK";
    case 3: return "data NACK";
    case 5: return "timeout";
    default: return "bus/other error";
  }
}

void scanI2c() {
  Serial.printf("\n[I2C] Scan 7-bit addresses 0x08..0x77 | SDA=21 SCL=22 | 100000 Hz\n[I2C] Idle levels: SDA=%d SCL=%d\n", digitalRead(21), digitalRead(22));
  uint8_t found = 0, errors = 0, lastError = 0;
  for (uint8_t address = 0x08; address <= 0x77; ++address) {
    Wire.beginTransmission(address);
    uint8_t result = Wire.endTransmission();
    if (result == 0) {
      Serial.printf("[I2C] Found ACK at 0x%02X (device identity not yet checked)\n", address);
      ++found;
    } else if (result != 2) {
      ++errors;
      lastError = result;
    }
    publish();
    delay(1);
  }
  Serial.printf("[I2C] Scan finished: %u ACK, %u bus errors/timeouts\n", found, errors);
  if (errors) Serial.printf("[I2C] Last scan error=%u (%s)\n", lastError, i2cResult(lastError));
  if (!found) Serial.println("[I2C] No device acknowledged. A scan alone cannot identify the cause.");
}

bool readRegisters(uint8_t reg, uint8_t *buffer, uint8_t count) {
  Wire.beginTransmission(mpuAddress);
  Wire.write(reg);
  uint8_t result = Wire.endTransmission(false);
  if (result != 0) {
    Serial.printf("[MPU] READ failed: address=0x%02X reg=0x%02X Wire=%u (%s)\n", mpuAddress, reg, result, i2cResult(result));
    return false;
  }
  size_t received = Wire.requestFrom(mpuAddress, count);
  if (received != count) {
    Serial.printf("[MPU] READ failed: address=0x%02X reg=0x%02X received=%u expected=%u bytes\n", mpuAddress, reg, unsigned(received), count);
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) buffer[i] = Wire.read();
  return true;
}

bool writeRegister(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(mpuAddress);
  Wire.write(reg); Wire.write(value);
  uint8_t result = Wire.endTransmission();
  if (result != 0) Serial.printf("[MPU] WRITE failed: address=0x%02X reg=0x%02X value=0x%02X Wire=%u (%s)\n", mpuAddress, reg, value, result, i2cResult(result));
  return result == 0;
}

bool configureMpu() {
  uint8_t selected = 0;
  Serial.println("[MPU] Checking addresses 0x68 and 0x69; WHO_AM_I register=0x75, expected MPU6500 ID=0x70");
  for (uint8_t address : {0x68, 0x69}) {
    mpuAddress = address;
    Wire.beginTransmission(address);
    uint8_t result = Wire.endTransmission();
    Serial.printf("[MPU] Probe address=0x%02X Wire=%u (%s)\n", address, result, i2cResult(result));
    if (result != 0) continue;
    uint8_t id;
    if (!readRegisters(0x75, &id, 1)) continue;
    Serial.printf("[MPU] address=0x%02X WHO_AM_I=0x%02X : %s\n", address, id, id == MPU6500_ID ? "MPU6500 ID matched" : "ID MISMATCH; not accepted as MPU6500");
    if (id == MPU6500_ID && selected == 0) selected = address;
  }
  if (selected == 0) {
    Serial.println("[MPU] No readable, matching MPU6500 ID. See the probe/read/ID messages above.");
    return false;
  }
  mpuAddress = selected;
  Serial.printf("[MPU] Selected address=0x%02X WHO_AM_I=0x70\n", mpuAddress);
  if (!writeRegister(0x6B, 0x80)) return false; // Reset prior sleep/standby/filter settings.
  delay(100);
  if (!writeRegister(0x6B, 0x01)) return false; // wake, PLL X gyro
  delay(100);
  const uint8_t settings[][2] = {
    {0x6C, 0x00}, // All accelerometer/gyro axes enabled.
    {0x1A, 0x03}, // Gyro DLPF ~41 Hz; GYRO_CONFIG FCHOICE_B=0.
    {0x19, 9},    // 1 kHz / (9 + 1) = 100 Hz.
    {0x1B, 0x00}, // Gyro +/-250 deg/s, 131 LSB/(deg/s).
    {0x1C, 0x00}, // Accelerometer +/-2 g, 16384 LSB/g.
    {0x1D, 0x03}, // MPU6500 ACCEL_CONFIG2: DLPF ~44.8 Hz, 1 kHz output.
  };
  for (const auto &setting : settings) {
    if (!writeRegister(setting[0], setting[1])) return false;
    uint8_t actual;
    if (!readRegisters(setting[0], &actual, 1)) return false;
    if (actual != setting[1]) {
      Serial.printf("[MPU] Config verification failed: reg=0x%02X expected=0x%02X actual=0x%02X\n", setting[0], setting[1], actual);
      return false;
    }
  }
  Serial.println("[MPU] MPU6500 configuration verified: +/-2g, +/-250dps, 100Hz, gyro DLPF=3, accel DLPF=3");
  return true;
}

bool readMpu() {
  uint8_t b[14];
  if (!readRegisters(0x3B, b, sizeof(b))) return false;
  auto raw = [&](uint8_t i) { return int16_t((uint16_t(b[i]) << 8) | b[i + 1]); };
  ax = raw(0) / 16384.0f; ay = raw(2) / 16384.0f; az = raw(4) / 16384.0f;
  gx = raw(8) / 131.0f; gy = raw(10) / 131.0f; gz = raw(12) / 131.0f;
  return true;
}

bool calibrate() {
  packet.imuStatus = CALIBRATING;
  Serial.println("Keep MPU6500 still for 3 seconds. Moving samples are rejected.");
  float sum[3] = {}, low[6], high[6];
  for (int j = 0; j < 6; ++j) { low[j] = 1e6f; high[j] = -1e6f; }
  uint32_t sampleTime = micros();
  for (int i = 0; i < 300; ++i) {
    while (uint32_t(micros() - sampleTime) < 10000) { publish(); delay(1); }
    sampleTime = micros();
    if (!readMpu()) { packet.imuStatus = IMU_ERROR; return false; }
    float norm = sqrtf(ax * ax + ay * ay + az * az);
    if (norm < 0.9f || norm > 1.1f || fabsf(gx) > 10 || fabsf(gy) > 10 || fabsf(gz) > 10) return false;
    float v[] = {gx, gy, gz, ax, ay, az};
    for (int j = 0; j < 6; ++j) { low[j] = fminf(low[j], v[j]); high[j] = fmaxf(high[j], v[j]); }
    sum[0] += gx; sum[1] += gy; sum[2] += gz;
  }
  for (int j = 0; j < 6; ++j) if (high[j] - low[j] > (j < 3 ? 2.0f : 0.08f)) return false;
  biasX = sum[0] / 300; biasY = sum[1] / 300; biasZ = sum[2] / 300;
  orientation.reset(ax, ay, az);
  packet.imuStatus = READY;
  lastSample = micros();
  Serial.printf("MPU6500 ready, address 0x%02X; relative yaw starts at 0.\n", mpuAddress);
  return true;
}

void setup() {
  Serial.begin(115200);
  pinMode(FSR_FRONT, INPUT); pinMode(FSR_REAR, INPUT);
  analogReadResolution(12);
  analogSetPinAttenuation(FSR_FRONT, ADC_11db);
  analogSetPinAttenuation(FSR_REAR, ADC_11db);
  if (!Wire.begin(21, 22)) Serial.println("[I2C] Wire.begin failed on SDA21/SCL22");
  Wire.setClock(100000); Wire.setTimeOut(50);
  BLEDevice::init("FSR-MPU-ESP32");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ConnectionCallbacks());
  BLEService *service = server->createService(SERVICE_UUID);
  dataCharacteristic = service->createCharacteristic(DATA_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  dataCharacteristic->addDescriptor(new BLE2902());
  dataCharacteristic->setValue(reinterpret_cast<uint8_t *>(&packet), sizeof(packet));
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  Serial.println("BLE: FSR-MPU-ESP32 | Front: GPIO35 | Rear: GPIO34 | SDA21 SCL22");
  scanI2c();
  lastAttempt = millis() - 2000;
}

void loop() {
  if (advertiseAgain.exchange(false)) BLEDevice::startAdvertising();
  if (packet.imuStatus != READY && uint32_t(millis() - lastAttempt) >= 2000) {
    if (!configureMpu()) {
      packet.imuStatus = IMU_ERROR;
      Serial.println("[MPU] Initialization failed. Retrying in 2 seconds; see diagnostics above.");
    } else if (!calibrate()) {
      Serial.println(packet.imuStatus == IMU_ERROR ? "[MPU] Calibration stopped: I2C read failed. Retrying." : "Calibration interrupted: keep sensor still. Retrying.");
    }
    lastAttempt = millis();
  }
  uint32_t now = micros(), elapsed = now - lastSample;
  if (packet.imuStatus == READY && elapsed >= 10000) {
    lastSample = now;
    if (!readMpu()) {
      packet.imuStatus = IMU_ERROR;
      Serial.println("MPU6500 read failed. Recalibration required.");
    } else if (elapsed > 50000) {
      packet.imuStatus = CALIBRATING; // Never integrate across a sampling gap.
    } else {
      orientation.update(ax, ay, az, gx - biasX, gy - biasY, gz - biasZ, elapsed / 1000000.0f);
    }
  }
  publish();
  delay(1);
}
