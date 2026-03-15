// ============================================================
//  WiFi Oscilloscope — ESP8266 Firmware — FINAL VERSION
//
//  Hardware: NodeMCU ESP8266 + ADS1115 + ACS712 30A
//
//  Voltage divider: 100kΩ + 51kΩ (R1) + 10kΩ (R2)
//  V_SCALE = (151k + 10k) / 10k = 16.1
//
//  ADS1115 DIFFERENTIAL MODE:
//    Voltage → A0(+) minus A1(−)   full signed ±
//    Current → A2(+) minus A3(−)   full signed ±
//
//  WIRING:
//    RED probe   → [100k+47k] → ADS1115 A0
//                              → [10k] → BLACK probe
//    BLACK probe → ADS1115 A1 → GND
//    ACS712 VIOUT → ADS1115 A2
//    ADS1115 A3   → GND
//    NodeMCU D1   → ADS1115 SCL
//    NodeMCU D2   → ADS1115 SDA
//    NodeMCU 3.3V → ADS1115 VDD
//    GND          → ADS1115 GND + ADDR
//
//  RANGE: Voltage ±30V  |  Current ±30A
//  NO capacitor. NO bias. Full signed waveform both channels.
//  WiFi: Station mode → connects to phone hotspot
// ============================================================

#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <Wire.h>
#include <Adafruit_ADS1X15.h>

// !! CHANGE THESE TO YOUR PHONE HOTSPOT !!
const char* WIFI_SSID = "Luna";
const char* WIFI_PASS = "1234pass";

ESP8266WebServer server(80);
Adafruit_ADS1115 ads;

// ── Sampling ─────────────────────────────────────────────────
#define MAX_SAMPLES 4000
#define DEFAULT_SAMPLES 2000
int numSamples = DEFAULT_SAMPLES;
float voltageBuffer[MAX_SAMPLES];
float currentBuffer[MAX_SAMPLES];

// ── State ─────────────────────────────────────────────────────
enum State { COLLECTING,
             CALCULATING,
             READY };
State state = COLLECTING;
unsigned long collectStart = 0;
int sampleIndex = 0;
unsigned long lastSampleTime = 0;

// ADS1115 at 860 SPS max
// Interleaved between 2 channels = 430 SPS per channel
// One pair every 2.32ms
const unsigned long SAMPLE_INTERVAL_US = 1163;

// ── Scale Constants ───────────────────────────────────────────
// R1 = 100kΩ + 47kΩ = 147kΩ, R2 = 10kΩ
// V_SCALE = (R1 + R2) / R2 = (147k + 10k) / 10k = 15.7
const float V_SCALE = 15.1f;

// ACS712 30A: VIOUT = 2.5V at 0A, 66mV per Amp
const float ACS_OFFSET = 1.7188f;
const float ACS_SENSITIVITY = 0.04538f;

// ── Results ───────────────────────────────────────────────────
struct Results {
  float vdc, vpeak, vnpeak, vpp, vrms, vcrest, vform, vripple;
  float idc, ipeak, inpeak, ipp, irms, icrest, iform;
  float realPower, apparentPower, reactivePower, powerFactor;
  float frequency;
  String signalType;
  int sampleCount;
  float windowSeconds;
} results;

// ═════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n╔══════════════════════════════════╗");
  Serial.println("║   WiFi Oscilloscope Firmware     ║");
  Serial.println("║   Differential Mode              ║");
  Serial.println("║   V_SCALE=15.7  Range: ±30V/±30A ║");
  Serial.println("╚══════════════════════════════════╝");

  // ADS1115 init
  Wire.begin(4, 5);                      // SDA=D2(GPIO4), SCL=D1(GPIO5)
  ads.setGain(GAIN_ONE);                 // ±4.096V input range
  ads.setDataRate(RATE_ADS1115_860SPS);  // 860 samples/sec max
  if (!ads.begin()) {
    Serial.println("ERROR: ADS1115 not found!");
    Serial.println("Check: SDA→D2, SCL→D1, VDD→3.3V, GND→GND, ADDR→GND");
    while (1) delay(500);
  }
  Serial.println("ADS1115 OK ✓");

  // WiFi station mode
  WiFi.mode(WIFI_STA);
   IPAddress staticIP(10, 142, 60, 200);
  IPAddress gateway(10, 214, 120, 1);
  IPAddress subnet(255, 255, 255, 0);
  WiFi.config(staticIP, gateway, subnet);

 
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.printf("Connecting to '%s'", WIFI_SSID);
  int t = 0;
  while (WiFi.status() != WL_CONNECTED && t < 40) {
    delay(500);
    Serial.print(".");
    t++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ Connected!");
    Serial.println("╔══════════════════════════════════╗");
    Serial.print("║  ESP IP: ");
    Serial.print(WiFi.localIP());
    Serial.println("          ║");
    Serial.println("║  >>> TYPE THIS INTO WEBPAGE <<<  ║");
    Serial.println("╚══════════════════════════════════╝");
  } else {
    Serial.println("\n✗ Failed to connect!");
    Serial.println("Check SSID and Password.");
  }

  // CORS allows browser to fetch from ESP
  server.enableCORS(true);

  // Routes
  server.on("/data", handleData);
  server.on("/status", handleStatus);
  server.on("/setsamples", handleSetSamples);

  server.begin();
  Serial.println("Web server started ✓");
  startCollecting();
}

// ═════════════════════════════════════════════════════════════
void loop() {
  server.handleClient();
  switch (state) {
    case COLLECTING:
      collectSample();
      break;
    case CALCULATING:
      calculateResults();
      state = READY;
      break;
    case READY:
      // 2 second pause then start fresh capture
      if (millis() - collectStart > (unsigned long)(results.windowSeconds * 1000) + 2000)
        startCollecting();
      break;
  }
}

// ═══ SAMPLING ════════════════════════════════════════════════
void startCollecting() {
  sampleIndex = 0;
  collectStart = millis();
  lastSampleTime = micros();
  state = COLLECTING;
  Serial.printf("► Collecting %d samples (%.2fs window)...\n",
                numSamples, (float)numSamples / 430.0f);
}

void collectSample() {
  if (sampleIndex >= numSamples) {
    Serial.println("► Done collecting. Calculating...");
    state = CALCULATING;
    return;
  }

  unsigned long now = micros();
  if (now - lastSampleTime < SAMPLE_INTERVAL_US) return;
  lastSampleTime = now;

  int idx = sampleIndex / 2;

  if (sampleIndex % 2 == 0) {
    // ── VOLTAGE: Differential A0(+) − A1(−) ─────────────
    // A0 = junction of R1 and R2 (signal after divider)
    // A1 = BLACK probe = circuit GND reference
    // Result is signed — negative AC half works correctly
    int16_t raw = ads.readADC_Differential_0_1();
    float adsV = ads.computeVolts(raw);
    // Scale to real circuit voltage
    // Positive: signal above BLACK probe → positive volts
    // Negative: signal below BLACK probe → negative volts
    float realV = adsV * V_SCALE;
    voltageBuffer[idx] = constrain(realV, -60.0f, 60.0f);

  } else {
    // ── CURRENT: Differential A2(+) − A3(−) ─────────────
    // A2 = ACS712 VIOUT pin
    // A3 = GND
    // Reads VIOUT directly as signed voltage
    // ACS712: 2.5V = 0A, above 2.5V = positive current
    //                     below 2.5V = negative current
    int16_t raw = ads.readADC_Differential_2_3();
    float adsV = ads.computeVolts(raw);
    float amps = (adsV - ACS_OFFSET) / ACS_SENSITIVITY;
    currentBuffer[idx] = constrain(amps, -31.0f, 31.0f);
  }

  sampleIndex++;
}

// ═══ CALCULATIONS ════════════════════════════════════════════
void calculateResults() {
  int n = numSamples / 2;  // samples per channel

  // ── Voltage stats ─────────────────────────────────────────
  float vSum = 0, vSumSq = 0;
  float vMax = -99999.0f, vMin = 99999.0f;
  for (int i = 0; i < n; i++) {
    float v = voltageBuffer[i];
    vSum += v;
    vSumSq += v * v;
    if (v > vMax) vMax = v;
    if (v < vMin) vMin = v;
  }
  results.vdc = vSum / n;
  results.vrms = sqrt(vSumSq / n);
  results.vpeak = vMax;
  results.vnpeak = vMin;
  results.vpp = vMax - vMin;

  float absPeakV = max(abs(vMax), abs(vMin));
  results.vcrest = (results.vrms > 0.01f) ? absPeakV / results.vrms : 0.0f;
  results.vform = (abs(results.vdc) > 0.01f) ? results.vrms / abs(results.vdc) : 0.0f;
  float vacRMS = sqrt(max(0.0f, results.vrms * results.vrms - results.vdc * results.vdc));
  results.vripple = (abs(results.vdc) > 0.01f) ? vacRMS / abs(results.vdc) : 0.0f;

  // ── Current stats ─────────────────────────────────────────
  float iSum = 0, iSumSq = 0;
  float iMax = -99999.0f, iMin = 99999.0f;
  for (int i = 0; i < n; i++) {
    float c = currentBuffer[i];
    iSum += c;
    iSumSq += c * c;
    if (c > iMax) iMax = c;
    if (c < iMin) iMin = c;
  }
  results.idc = iSum / n;
  results.irms = sqrt(iSumSq / n);
  results.ipeak = iMax;
  results.inpeak = iMin;
  results.ipp = iMax - iMin;
  results.icrest = (results.irms > 0.001f) ? max(abs(iMax), abs(iMin)) / results.irms : 0.0f;
  results.iform = (abs(results.idc) > 0.001f) ? results.irms / abs(results.idc) : 0.0f;

  // ── Power stats ───────────────────────────────────────────
  float pSum = 0;
  for (int i = 0; i < n; i++)
    pSum += voltageBuffer[i] * currentBuffer[i];
  results.realPower = pSum / n;
  results.apparentPower = results.vrms * results.irms;
  results.reactivePower = sqrt(max(0.0f,
                                   results.apparentPower * results.apparentPower - results.realPower * results.realPower));
  results.powerFactor = (results.apparentPower > 0.001f)
                          ? results.realPower / results.apparentPower
                          : 0.0f;

  // ── Frequency ─────────────────────────────────────────────
  results.frequency = calculateFrequency(n);

  // ── Signal type ───────────────────────────────────────────
  if (results.vpp < 0.3f) results.signalType = "DC Constant";
  else if (abs(results.vdc) < 0.15f * results.vrms) results.signalType = "Pure AC";
  else if (results.frequency > 1.0f) results.signalType = "AC with DC Offset";
  else results.signalType = "DC with Ripple";

  results.sampleCount = n;
  results.windowSeconds = (float)n / 430.0f;

  Serial.printf("✓ Vpp=%.2fV Vdc=%.2fV Vrms=%.2fV Vpk+=%.2f Vpk-=%.2f Freq=%.1fHz [%s]\n",
                results.vpp, results.vdc, results.vrms,
                results.vpeak, results.vnpeak,
                results.frequency, results.signalType.c_str());
}

float calculateFrequency(int n) {
  // Zero crossing detection at true 0V
  // Works correctly because signal is fully signed
  int count = 0;
  float totalMs = 0.0f;
  int lastIdx = -1;

  for (int i = 1; i < n; i++) {
    // Rising crossing through 0V
    if (voltageBuffer[i - 1] < 0.0f && voltageBuffer[i] >= 0.0f) {
      if (lastIdx >= 0) {
        totalMs += (float)(i - lastIdx) * 2.32f;
        count++;
      }
      lastIdx = i;
    }
  }

  if (count == 0) return 0.0f;
  float avgMs = totalMs / (float)count;
  return (avgMs > 0.0f) ? 1000.0f / avgMs : 0.0f;
}

// ═══ SERVER HANDLERS ═════════════════════════════════════════
void handleStatus() {
  float elapsed = (millis() - collectStart) / 1000.0f;
  float total = (float)numSamples / 430.0f;
  float pct = min(100.0f, (elapsed / total) * 100.0f);
  String s = (state == COLLECTING) ? "collecting" : (state == CALCULATING) ? "calculating"
                                                                           : "ready";
  server.send(200, "application/json",
              "{\"state\":\"" + s + "\","
                                    "\"elapsed\":"
                + String(elapsed, 2) + ","
                                       "\"total\":"
                + String(total, 2) + ","
                                     "\"percent\":"
                + String(pct, 1) + ","
                                   "\"samples\":"
                + String(numSamples) + "}");
}

void handleData() {
  if (state != READY) {
    server.send(200, "application/json", "{\"status\":\"not_ready\"}");
    return;
  }
  int n = numSamples / 2;

  String json = "{\"status\":\"ready\",";
  json += "\"signal_type\":\"" + results.signalType + "\",";
  json += "\"sample_count\":" + String(n) + ",";
  json += "\"window_seconds\":" + String(results.windowSeconds, 2) + ",";
  json += "\"time_per_sample_ms\":2.32,";

  // Voltage samples — signed values
  json += "\"voltage\":[";
  for (int i = 0; i < n; i++) {
    json += String(voltageBuffer[i], 3);
    if (i < n - 1) json += ",";
  }
  json += "],";

  // Current samples — signed values
  json += "\"current\":[";
  for (int i = 0; i < n; i++) {
    json += String(currentBuffer[i], 3);
    if (i < n - 1) json += ",";
  }
  json += "],";

  // Voltage metrics
  json += "\"v\":{"
          "\"dc\":"
          + String(results.vdc, 3) + ","
                                     "\"peak\":"
          + String(results.vpeak, 3) + ","
                                       "\"npeak\":"
          + String(results.vnpeak, 3) + ","
                                        "\"pp\":"
          + String(results.vpp, 3) + ","
                                     "\"rms\":"
          + String(results.vrms, 3) + ","
                                      "\"crest\":"
          + String(results.vcrest, 3) + ","
                                        "\"form\":"
          + String(results.vform, 3) + ","
                                       "\"ripple\":"
          + String(results.vripple, 3) + "},";

  // Current metrics
  json += "\"i\":{"
          "\"dc\":"
          + String(results.idc, 3) + ","
                                     "\"peak\":"
          + String(results.ipeak, 3) + ","
                                       "\"npeak\":"
          + String(results.inpeak, 3) + ","
                                        "\"pp\":"
          + String(results.ipp, 3) + ","
                                     "\"rms\":"
          + String(results.irms, 3) + ","
                                      "\"crest\":"
          + String(results.icrest, 3) + ","
                                        "\"form\":"
          + String(results.iform, 3) + "},";

  // Power metrics
  json += "\"p\":{"
          "\"real\":"
          + String(results.realPower, 3) + ","
                                           "\"apparent\":"
          + String(results.apparentPower, 3) + ","
                                               "\"reactive\":"
          + String(results.reactivePower, 3) + ","
                                               "\"pf\":"
          + String(results.powerFactor, 3) + "},";

  json += "\"frequency\":" + String(results.frequency, 2) + "}";
  server.send(200, "application/json", json);
}

void handleSetSamples() {
  if (server.hasArg("n")) {
    int n = server.arg("n").toInt();
    if (n >= 1000 && n <= MAX_SAMPLES) {
      numSamples = (n % 2 == 0) ? n : n - 1;
      startCollecting();
      server.send(200, "application/json",
                  "{\"ok\":true,\"samples\":" + String(numSamples) + "}");
      Serial.printf("► Samples changed to %d\n", numSamples);
    } else {
      server.send(400, "application/json", "{\"error\":\"Range: 1000-4000\"}");
    }
  } else {
    server.send(400, "application/json", "{\"error\":\"Missing n\"}");
  }
}
