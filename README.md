# WiFi-CRO — WiFi Oscilloscope

A portable, browser-based oscilloscope built around the ESP8266 microcontroller. WiFi-CRO captures real-time voltage and current waveforms and streams them over WiFi to any device with a browser — no drivers, no software installation, no oscilloscope hardware required.

---

## What It Does

WiFi-CRO turns a handful of cheap components into a fully functional dual-channel oscilloscope. Connect your probes to a circuit, open index.html on your laptop, and see live waveforms — voltage on one channel, current on the other. It handles DC signals, square waves, and AC sine waves up to 200 Hz. An onboard FFT identifies signal frequency, and an AI analysis button powered by **Google Gemini 2.5 Flash** classifies the signal type and diagnoses circuit health automatically.

The system works entirely over WiFi. The ESP8266 connects to your phone's hotspot, gets an IP address, and your laptop fetches waveform data directly from that IP. No internet connection is required except for the Gemini AI feature.

---

## How It Works

The ESP8266 hosts a lightweight HTTP endpoint that serves raw ADC samples as JSON. The ADS1115 runs in continuous conversion mode, alternating between the voltage channel (A0−A1) and current channel (A2−A3) at 860 SPS combined. The browser frontend fetches this data, renders the waveform on canvas, computes an FFT to extract frequency, and calculates RMS, Vpp, and crest factor.

The key design decision is differential ADC mode throughout. Single-ended mode can only represent positive voltages. Differential mode computes the difference between two inputs, so the signal swings positive and negative relative to the reference — capturing the full AC waveform without any coupling capacitor or software DC offset correction.

---

## Specifications

| Parameter | Value |
|-----------|-------|
| Voltage range | ±30V (hardware limit ±51.8V via Zener) |
| Current range | ±30A continuous (with ACS712 output divider) |
| Frequency response | DC to 200 Hz |
| Sample rate | 430 SPS per channel (860 SPS interleaved) |
| Voltage resolution | ~2 mV |
| Current resolution | ~1.9 mA |
| Waveform capture | Full signed ±, both halves captured |
| Interface | Phone hotspot → ESP8266 → browser |

---

## Hardware Overview

The circuit is divided into four subsystems.

**Power Chain** A 3.7V LiPo battery powers the system. A TP4056 handles USB-C charging. An MT3608 boost converter steps the voltage up to a stable 5V rail for the NodeMCU and ACS712. The NodeMCU's onboard regulator supplies 3.3V to the ADS1115. The MT3608 output must be set to exactly 5.0V before connecting anything — too high damages the NodeMCU, too low and it won't boot.

**Voltage Measurement** The input is scaled down by a resistor divider: R1 is 100kΩ + 47kΩ = 147kΩ in series, and R2 is 10kΩ, giving a scale factor of 15.7. A 3.3V Zener diode clamps the ADC input for protection. A 0.1µF capacitor filters high-frequency noise at the same node.

**Current Measurement** The ACS712 hall-effect sensor wires in series with the load. It outputs 2.5V at 0A and shifts by 66mV per amp. To support the full ±30A range safely without exceeding the ADS1115 3.3V input limit, the VIOUT signal is scaled down through a **10kΩ/22kΩ resistor divider** before reaching the ADC. This scales the 0.5V–4.5V ACS712 output range down to 0.34V–3.09V — safely within ADS1115 limits at all current levels. The sensor is fully isolated — no direct electrical connection to the circuit under test.

**The Brain** The ADS1115 is a 16-bit I2C ADC running at 860 SPS. Both channels are read in interleaved mode at 430 SPS per channel. The ESP8266 reads data over I2C and serves it over WiFi.

---

## Component List

| Component | Specification |
|-----------|--------------|
| NodeMCU ESP8266 | v3, CH340G |
| ADS1115 module | 16-bit, I2C, 860 SPS |
| ACS712 module | 30A version |
| Resistor R1a | 100kΩ ¼W 1% |
| Resistor R1b | 47kΩ ¼W 1% |
| Resistor R2 | 10kΩ ¼W 1% |
| Resistor R3 | 10kΩ ¼W (ACS712 output divider) |
| Resistor R4 | 22kΩ ¼W (ACS712 output divider) |
| Zener diode | 3.3V — 1N4728A or BZX55C3V3 |
| Capacitors | 0.1µF ceramic 50V (×2) |
| LiPo battery | 3.7V, 1000–2000mAh |
| TP4056 module | Type-C charging |
| MT3608 boost | 5V boost converter |
| Breadboard | 400-tie half size |
| Jumper wires | M-M and M-F |
| Probe wires | Alligator clips — RED, BLACK, YELLOW, ORANGE |

---

## Wiring

### NodeMCU Pin Assignments

| Pin | GPIO | Connects To |
|-----|------|------------|
| 3V3 | — | ADS1115 VDD |
| GND | — | ADS1115 GND + ADDR, ACS712 GND, R2 bottom, ADS1115 A1, ADS1115 A3 |
| VIN | — | MT3608 5V output |
| D1 | GPIO5 | ADS1115 SCL |
| D2 | GPIO4 | ADS1115 SDA |

### ADS1115 Pin Assignments

| Pin | Connects To | Notes |
|-----|------------|-------|
| VDD | NodeMCU 3V3 | 3.3V only — never 5V |
| GND | NodeMCU GND | Common ground |
| SCL | NodeMCU D1 (GPIO5) | I2C clock |
| SDA | NodeMCU D2 (GPIO4) | I2C data |
| ADDR | GND | Sets I2C address to 0x48 |
| A0 | Voltage divider junction | Differential+ voltage channel |
| A1 | BLACK probe / GND | Differential− voltage reference |
| A2 | ACS712 output divider junction | Differential+ current channel |
| A3 | GND | Differential− current reference |

### Voltage Divider

```
RED probe ──[100kΩ]──[47kΩ]──┬──── ADS1115 A0 (+)
                              │
                            [10kΩ]   [Zener 3.3V]   [0.1µF]
                              │       (A0 → GND)    (A0 → GND)
BLACK probe ─────────────────┴──── ADS1115 A1 (−)
                              │
                             GND
```

ADS1115 reads A0 − A1. Multiply by 15.7 to get real voltage.

### Current Sensor with Output Divider (±30A Support)

The ACS712 VIOUT pin swings from 0.5V (−30A) to 4.5V (+30A). Without a divider this exceeds the ADS1115's 3.3V safe input at high positive currents. A 10kΩ/22kΩ divider scales the output down so the full ±30A range stays safely within ADS1115 limits.

```
YELLOW probe ── ACS712 IP+ ──[conductor]── ACS712 IP− ── ORANGE probe

ACS712 VIOUT ── 0.1µF ──[10kΩ]──┬──── ADS1115 A2 (+)
                                 │
                               [22kΩ]
                                 │
                                GND ──── ADS1115 A3 (−)
```

Divider scale factor = 22 / (10 + 22) = 0.6875

| Condition | VIOUT | After Divider | Safe? |
|-----------|-------|---------------|-------|
| 0A (idle) | 2.50V | 1.72V | ✅ |
| +30A | 4.48V | 3.08V | ✅ |
| −30A | 0.52V | 0.36V | ✅ |

### Power Chain

```
LiPo 3.7V → TP4056 → MT3608 (set to 5.0V) ─┬─ NodeMCU VIN
                                              └─ ACS712 VCC
NodeMCU 3V3 ─────────────────────────────────── ADS1115 VDD
```

---

## Build Order

**Step 1 — Set boost converter voltage first**
Power MT3608 from TP4056 only (NodeMCU disconnected). Measure MT3608 output and turn the trimmer pot until it reads exactly 5.0V. This is the most critical step — never skip it.

**Step 2 — Power rails**
MT3608 OUT+ to 5V breadboard rail, GND to GND rails. NodeMCU VIN to 5V rail, GND to GND. Power on — the NodeMCU LED should light.

**Step 3 — I2C wiring**
D1 → ADS1115 SCL, D2 → ADS1115 SDA, NodeMCU 3V3 → ADS1115 VDD, NodeMCU GND → ADS1115 GND and ADDR.

**Step 4 — Upload firmware and verify I2C**
Flash esp8266_firmware.ino. Open Serial Monitor at 115200 baud. Should print ADS1115 OK and the ESP's IP address. If you see ADS1115 not found, check D1/D2 are not swapped.

**Step 5 — Build voltage divider**
R1a (100kΩ) and R1b (47kΩ) in series. R2 (10kΩ) from that junction to GND rail. Junction → ADS1115 A0. BLACK probe rail → ADS1115 A1 and bottom of R2.

**Step 6 — Add protection**
Zener diode cathode to A0 junction, anode to GND. 0.1µF cap across the same two points.

**Step 7 — Test voltage channel**
RED probe to 9V battery +, BLACK to −. Browser at ESP IP should show Vdc ≈ 9V. If slightly off, measure with multimeter and adjust V_SCALE in firmware.

**Step 8 — Wire ACS712 with output divider**
ACS712 VCC → 5V rail, GND → GND rail.
VIOUT → 0.1µF filter cap → 10kΩ resistor → junction → ADS1115 A2.
From same junction, 22kΩ resistor → GND.
GND → ADS1115 A3.
YELLOW and ORANGE probes to IP+ and IP−.

**Step 9 — Test current channel**
With probes disconnected, current should read 0.00A. Connect probes in series with a small load and confirm the reading responds.

**Step 10 — Full system test**
Connect a 3-0-3 transformer (full 6V winding). Voltage channel should show a sine wave at ±8.5V, 50Hz, crest factor ≈ 1.414.

---

## Firmware Configuration

Only two lines need changing:

```cpp
#define WIFI_SSID  "YourHotspotName"
#define WIFI_PASS  "YourHotspotPassword"
```

All other constants are pre-configured and should be left as-is:

| Constant | Value | Notes |
|----------|-------|-------|
| V_SCALE | 15.7 | (100k + 47k + 10k) / 10k |
| ACS_OFFSET | 1.7188 | 2.5V × 0.6875 — adjusted for 10k/22k divider |
| ACS_SENSITIVITY | 0.04538 | 0.066 × 0.6875 — adjusted for 10k/22k divider |
| SAMPLE_RATE | 860 SPS | 430 per channel |
| SCL | GPIO5 (D1) | — |
| SDA | GPIO4 (D2) | — |
| ADS1115 address | 0x48 | ADDR pin tied to GND |

---

## 🏆 MLH Google Cloud — Gemini API Challenge

This project uses **Google Gemini 2.5 Flash API** as the core intelligence layer. Gemini is not a chatbot here — it is the diagnostic brain of the device, receiving live sensor data and visually analysing real electrical waveforms.

### How We Use Gemini API

**Mode 1 — Numerical Circuit Analysis**

All calculated measurements are sent to Gemini which identifies the circuit type and diagnoses its health in real time:

```
Signal type, Frequency, Vrms, Vpeak, Vpp, Crest Factor, Ripple %
Irms, Ipeak, Power Factor, Real Power, Apparent Power
THD-V % (Total Harmonic Distortion — Voltage)
THD-I % (Total Harmonic Distortion — Current)
FFT fundamental frequency
```

Gemini responds with circuit identification, confidence %, health status (Good / Warning / Fault), detailed diagnosis mentioning specific values, and a warnings list.

**Mode 2 — Visual Waveform Analysis (Multimodal Vision)**

The second AI button captures a live screenshot of the actual oscilloscope waveform graph and sends it to Gemini alongside the numerical data. Gemini visually describes waveform shape, symmetry, distortion, and clipping — combining visual and numerical analysis for the most accurate circuit identification possible.

### Gemini API Details

```
Model:    gemini-2.5-flash
Endpoint: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
Auth:     API key from aistudio.google.com
Cost:     Free tier — 250 requests/day, 250,000 tokens/minute
```

### Get Your Free API Key

```
1. Go to aistudio.google.com
2. Sign in with Google account
3. Click "Get API Key" → "Create API key"
4. Paste into the GEMINI KEY box in the webpage
```

---

## Usage

1. Power on the device
2. Enable your phone hotspot (SSID and password matching firmware)
3. ESP8266 connects and prints its IP to Serial Monitor at 115200 baud
4. Open index.html on a laptop connected to the same hotspot
5. Enter the ESP IP in the top bar
6. Enter your Gemini API key in the top bar
7. Attach probes — data streams automatically
8. Press **Analyse by Numbers** or **Analyse Waveform Image** for AI diagnosis

---

## Probe Guide

| Probe | Colour | Connection |
|-------|--------|-----------|
| Voltage + | RED | Circuit positive |
| Voltage − | BLACK | Circuit negative / GND |
| Current in | YELLOW | ACS712 IP+ (current enters) |
| Current out | ORANGE | ACS712 IP− (current exits) |

Voltage only: RED + BLACK. Current only: YELLOW + ORANGE. Both channels: all four probes.

---

## Demo Circuits

**Demo A — DC Battery**
RED to battery +, BLACK to battery −. Expected: flat line, Vdc ≈ battery voltage, Vpp < 0.1V, frequency 0 Hz.

**Demo B — AC Transformer**
3-0-3 step-down, full 6V winding, 220Ω load. RED and BLACK to outer secondary terminals. YELLOW/ORANGE in series with the load. Expected: full sine wave ±8.5V at 50Hz, crest factor ≈ 1.414, both halves clearly visible.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| ADS1115 not found | D1/D2 likely swapped — SDA/SCL reversal is most common mistake. Check 3.3V on VDD |
| Voltage reads 0V | Check R1/R2 divider wiring. Confirm A1 connects to BLACK probe. Verify GAIN_ONE in firmware |
| Voltage reads wrong value | Measure with multimeter. Adjust: V_SCALE = multimeter_reading / ads_reading |
| AC shows only positive half | A1 must go to BLACK probe, not GND. Must use readADC_Differential_0_1 |
| Current always 0A | ACS712 requires 5V on VCC. Check VIOUT connected to 10kΩ/22kΩ divider |
| Current reads ~38A at rest | ACS712 VCC missing. VIOUT should idle at 2.5V → 1.72V after divider |
| Current range seems limited | Verify 10kΩ/22kΩ divider wired correctly on VIOUT before A2 |
| Cannot reach ESP IP | Laptop and ESP must be on same WiFi network. Check SSID/password in firmware |
| AI button greyed out | Enables only after first successful capture. Wait for CAPTURE COMPLETE status |
| Gemini returns error | Check API key is correct. Get free key at aistudio.google.com |
| Noisy waveform | Verify both 0.1µF caps in place. Check common GND rail. Keep probe wires short |
| NodeMCU not booting | Recheck MT3608 output. Below 4.5V = won't boot; above 5.5V = board may be damaged |

---

## Safety

- Never connect probes to mains 230V AC. Maximum safe input voltage is ±51.8V.
- Always verify MT3608 output is exactly 5.0V before connecting the NodeMCU.
- All GND connections must share a common rail before powering on.
- ACS712 is rated for ±30A continuous. Do not exceed ±40A even briefly.

---



## License

MIT License — see LICENSE file for details.

---

## Author

NAMAN MALHOTRA

NIT Hamirpur | 2026

---
