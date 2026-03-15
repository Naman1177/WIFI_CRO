# WiFi-CRO — AI-Powered Portable WiFi Oscilloscope

> **Replacing ₹50,000 lab equipment with an ₹800 intelligent measurement device**

Built for **Electrothon 8.0** | NIT Hamirpur | First Year Engineering Student

---

https://drive.google.com/file/d/1rVGG4GUArWKFOIuTq2kKLgNRNvUQqXf-/view?usp=sharing


## 🏆 MLH Google Cloud — Gemini API Challenge

This project uses **Google Gemini 2.5 Flash API** as the core intelligence layer of a real hardware oscilloscope. Gemini is not a chatbot here — it is the diagnostic brain of the entire device.

---

## 🤖 How We Use Gemini API

### Mode 1 — Numerical Circuit Analysis

After capturing live electrical measurements, all calculated values are sent to Gemini 2.5 Flash which identifies the circuit type and diagnoses its health in real time.

Data sent to Gemini:
```
Signal type, Frequency, Vrms, Vpeak, Vpp, Crest Factor, Ripple %
Irms, Ipeak, Power Factor, Real Power, Apparent Power
THD-V % (Total Harmonic Distortion — Voltage)
THD-I % (Total Harmonic Distortion — Current)
FFT fundamental frequency
```

Gemini responds with:
```
Circuit identification → Battery / Transformer / Phone charger / 555 Timer / etc.
Confidence percentage
Health status → Good ✅ / Warning ⚠️ / Fault ❌
Detailed diagnosis mentioning specific measured values
Warnings → aging capacitor / high distortion / poor power factor etc.
```

### Mode 2 — Visual Waveform Analysis (Multimodal Vision)

The second AI button captures a **live screenshot of the actual oscilloscope waveform graph** and sends it to Gemini along with numerical data. Gemini visually analyses the image and describes:

```
Waveform shape → sine / square / triangle / flat / noisy
Symmetry of positive and negative peaks
Visible distortion, clipping, or anomalies
Approximate cycles visible in the capture window
```

This is Gemini doing something genuinely new — **visually reading a real electrical waveform** and reasoning about it like an expert engineer.

### Why This is a Strong Gemini Use Case

Most hackathon projects use Gemini as a chatbot answering text questions. This project uses Gemini as a **real-time hardware diagnostic engine** receiving live data from physical sensors and performing expert-level circuit analysis that would otherwise require years of engineering experience to interpret manually.

---

## 🔌 Gemini API Technical Details

### Model and Endpoint

```
Model:    gemini-2.5-flash
Endpoint: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
Auth:     API key from aistudio.google.com
```

### Numbers Mode — Request Structure

```json
{
  "contents": [{
    "parts": [{
      "text": "System prompt + measurement JSON data"
    }]
  }],
  "generationConfig": {
    "temperature": 0.1,
    "maxOutputTokens": 500
  }
}
```

### Image Mode — Request Structure (Multimodal)

```json
{
  "contents": [{
    "parts": [
      { "text": "System prompt + measurement data" },
      { "inline_data": {
          "mime_type": "image/png",
          "data": "<base64 screenshot of live waveform graph>"
        }
      }
    ]
  }]
}
```

### Gemini Response Format

Gemini is prompted to respond in strict JSON for reliable parsing:

```json
{
  "circuit_type": "AC transformer output",
  "confidence": 92,
  "health": "Good",
  "summary": "Clean 50Hz sine wave from a standard transformer",
  "details": "Vrms of 6.2V with crest factor 1.41 confirms pure sine wave. THD of 3.2% is within acceptable range. Power factor of 0.98 indicates resistive load.",
  "visual_observation": "Waveform shows symmetric positive and negative cycles with smooth sine shape. No visible clipping or distortion. Approximately 230 complete cycles visible.",
  "warnings": []
}
```

### Token Usage Per Request

| Mode | Input Tokens | Output Tokens | Total |
|------|-------------|---------------|-------|
| Numbers only | ~550 | ~200 | ~750 |
| Image + Numbers | ~1300 | ~250 | ~1550 |

Well within free tier limits (250,000 TPM, 250 RPD).

---

## 💻 Software Features

### Webpage (index.html — single file, no server needed)

- Double-click to open in any browser — no installation required
- Live voltage and current waveform graphs with correct time axis
- **FFT Spectrum** — Cooley-Tukey algorithm in pure JavaScript
- **THD Calculation** — Total Harmonic Distortion for voltage and current
- **Circuit Health Score** — 0 to 100 with sub-scores
- **Trend Monitor** — tracks last 5 captures, warns if metrics drifting
- **CSV Export** — download raw waveform data
- **Gemini AI** — two analysis modes (numbers + waveform image)

### Sample Modes

| Mode | Capture Window | FFT Resolution | Best For |
|------|---------------|----------------|----------|
| 1000 samples | 2.3s | 0.43 Hz | Viewing waveform shape |
| 2000 samples | 4.6s | 0.22 Hz | Daily use |
| 3000 samples | 6.9s | 0.14 Hz | Better THD accuracy |
| 4000 samples | 9.3s | 0.11 Hz | Maximum accuracy |

---

## 🚀 Setup

### Get Gemini API Key (Free)

```
1. Go to aistudio.google.com
2. Sign in with Google account
3. Click "Get API Key" → "Create API key"
4. Copy the key (starts with AIzaSy...)
```

### Run the Oscilloscope

```
1. Flash esp8266_firmware.ino to NodeMCU
   → Change WIFI_SSID and WIFI_PASS on lines ~20-21
2. Double-click index.html in any browser
3. Enter ESP IP address (shown in Serial Monitor at 115200 baud)
4. Enter Gemini API key
5. Data streams automatically
6. Press "Analyse by Numbers" or "Analyse Waveform Image"
```

---



## 📄 License

MIT License — see LICENSE file for details.

---

## 👤 Author

NAMAN MALHOTRA  
NIT Hamirpur | 2026

---
