#pragma once
#include <math.h>

// Gyroscope integration + accelerometer gravity correction (nonlinear complementary filter).
class OrientationFilter {
  float w = 1, x = 0, y = 0, z = 0;
  static constexpr float RAD = 0.017453292519943295f;
public:
  void reset(float ax, float ay, float az) {
    float r = atan2f(ay, az) / 2;
    float p = atan2f(-ax, sqrtf(ay * ay + az * az)) / 2;
    w = cosf(r) * cosf(p); x = sinf(r) * cosf(p);
    y = cosf(r) * sinf(p); z = -sinf(r) * sinf(p);
  }
  void update(float ax, float ay, float az, float gx, float gy, float gz, float dt) {
    if (!(dt > 0 && dt <= 0.05f)) return;
    gx *= RAD; gy *= RAD; gz *= RAD;
    float norm = sqrtf(ax * ax + ay * ay + az * az);
    // shortcut: gravity is unreliable during sustained acceleration; use a motion model if needed.
    if (norm > 0.85f && norm < 1.15f) {
      ax /= norm; ay /= norm; az /= norm;
      float vx = 2 * (x * z - w * y), vy = 2 * (w * x + y * z);
      float vz = w * w - x * x - y * y + z * z;
      constexpr float GAIN = 2.0f;
      gx += GAIN * (ay * vz - az * vy);
      gy += GAIN * (az * vx - ax * vz);
      gz += GAIN * (ax * vy - ay * vx);
    }
    float halfDt = dt * 0.5f;
    float nw = w + (-x * gx - y * gy - z * gz) * halfDt;
    float nx = x + ( w * gx + y * gz - z * gy) * halfDt;
    float ny = y + ( w * gy - x * gz + z * gx) * halfDt;
    float nz = z + ( w * gz + x * gy - y * gx) * halfDt;
    norm = sqrtf(nw * nw + nx * nx + ny * ny + nz * nz);
    w = nw / norm; x = nx / norm; y = ny / norm; z = nz / norm;
  }
  float roll() const { return atan2f(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) / RAD; }
  float pitch() const {
    float v = 2 * (w * y - z * x);
    return asinf(fmaxf(-1, fminf(1, v))) / RAD;
  }
  float yaw() const { return atan2f(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) / RAD; }
};
