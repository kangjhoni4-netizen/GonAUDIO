import { useRef, useState } from "react";
import "./App.css";

import {
  processAudio,
  downloadBlob,
  formatBytes,
} from "./audioProcessor";

const PRESETS = [
  { name: "BYPASS 1", speed: "0.43" },
  { name: "BYPASS 2", speed: "0.50" },
  { name: "BYPASS 3", speed: "0.65" },
  { name: "BYPASS 4", speed: "0.80" },
  { name: "BYPASS 5", speed: "1.00" },
  { name: "CUSTOM", speed: "Manual" },
];

function App() {
  const fileInputRef = useRef(null);

  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customRobloxRate, setCustomRobloxRate] = useState("0.43");
  const [dragging, setDragging] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedFile, setProcessedFile] = useState(null);
  const [error, setError] = useState("");

  const preset = PRESETS[selectedPreset];

  const parsedCustomRobloxRate = Number(customRobloxRate);

  const activeRobloxRate =
    selectedPreset === 5
      ? parsedCustomRobloxRate
      : Number(preset.speed);

  const activeProcessingSpeed =
    1 / activeRobloxRate;

  const handleFile = (file) => {
    if (!file) return;

    const validAudio =
      file.type.startsWith("audio/") ||
      /\.(mp3|wav|ogg|flac|m4a|mp4)$/i.test(file.name);

    if (!validAudio) {
      setError("Silakan pilih file audio yang didukung.");
      return;
    }

    setSelectedFile(file);
    setProcessedFile(null);
    setError("");
    setProgress(0);
  };

  const handleInputChange = (event) => {
    handleFile(event.target.files?.[0]);

    // Memungkinkan memilih file yang sama kembali
    event.target.value = "";
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);

    handleFile(event.dataTransfer.files?.[0]);
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const formatSize = (bytes) => {
    if (!bytes) return "0 KB";

    const mb = bytes / 1024 / 1024;

    if (mb >= 1) {
      return `${mb.toFixed(2)} MB`;
    }

    return `${Math.max(
      1,
      Math.round(bytes / 1024)
    )} KB`;
  };

  const handlePresetChange = (index) => {
    setSelectedPreset(index);
    setProcessedFile(null);
    setError("");
    setProgress(0);
  };

  const handleProcess = async () => {
    if (!selectedFile) {
      setError("Upload audio terlebih dahulu.");
      return;
    }

    if (processing) {
      return;
    }

    setError("");
    setProcessedFile(null);
    setProcessing(true);
    setProgress(0);

    try {
      const robloxPlaybackRate =
        activeRobloxRate;

      const processingSpeed =
        activeProcessingSpeed;

      if (
        !Number.isFinite(robloxPlaybackRate) ||
        robloxPlaybackRate <= 0 ||
        !Number.isFinite(processingSpeed) ||
        processingSpeed <= 0
      ) {
        throw new Error(
          "Target playback rate Roblox tidak valid."
        );
      }

      const result = await processAudio(
        selectedFile,
        processingSpeed,
        setProgress
      );

      setProcessedFile(result);

      const baseName = selectedFile.name
        .replace(/\.[^/.]+$/, "")
        .replace(/[^\w\- ]/g, "")
        .trim() || "audio";

      const safePresetName =
        preset.name.replace(/\s+/g, "_");

      downloadBlob(
        result.blob,
        `${baseName}_GonAUDIO_${safePresetName}.ogg`
      );
    } catch (err) {
      console.error(err);

      setError(
        err?.message ||
          "Terjadi kesalahan saat memproses audio."
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="app">
      <div className="background-glow glow-one" />
      <div className="background-glow glow-two" />

      <main className="container">

        {/* HERO */}
        <section className="hero">

          <div className="version-badge">
            <span className="badge-dot" />
            AUDIO PROCESSING V1.0
          </div>

          <h1>
            UBAH AUDIO ANDA
            <span>BUAT SIAP UNTUK</span>
            ROBLOX
          </h1>

          <p>
            PROSES AUDIO DENGAN PENGATURAN KECEPATAN, NADA, DAN GAIN
            <br />
            YANG DISESUAIKAN — DIBUAT UNTUK WORKFLOW AUDIO ROBLOX
          </p>

        </section>

        {/* MAIN WORKSPACE */}
        <section className="workspace">

          {/* UPLOAD */}
          <div className="upload-section">

            <div
              className={`upload-box ${
                dragging ? "dragging" : ""
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={openFilePicker}
            >

              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.ogg,.flac,.m4a,.mp4,audio/*"
                onChange={handleInputChange}
                hidden
              />

              <div className="upload-icon" />

              <h2>
                {selectedFile
                  ? "Audio Selected"
                  : "Upload your audio"}
              </h2>

              {selectedFile ? (
                <>
                  <div className="selected-file">

                    <strong>
                      {selectedFile.name}
                    </strong>

                    <span>
                      {formatSize(selectedFile.size)}
                    </span>

                  </div>

                </>
              ) : (
                <>
                  <p>
                    Drag & drop atau klik di sini untuk{" "}
                    <span>browse</span>
                  </p>

                  <div className="formats">
                    MP3&nbsp;&nbsp;•&nbsp;&nbsp;
                    WAV&nbsp;&nbsp;•&nbsp;&nbsp;
                    OGG&nbsp;&nbsp;•&nbsp;&nbsp;
                    FLAC&nbsp;&nbsp;•&nbsp;&nbsp;
                    M4A&nbsp;&nbsp;•&nbsp;&nbsp;
                    MP4
                  </div>
                </>
              )}

            </div>

          </div>

          {/* SETTINGS */}
          <div className="settings-section">

            {/* PRESETS */}
            <div className="presets">

              {PRESETS.map((item, index) => (

                <button
                  key={item.name}
                  type="button"
                  className={`preset-card ${
                    selectedPreset === index
                      ? "active"
                      : ""
                  }`}
                  onClick={() =>
                    handlePresetChange(index)
                  }
                  disabled={processing}
                >

                  <span className="preset-number">
                    {index + 1}
                  </span>

                  <strong>
                    {item.name}
                  </strong>

                  <small>
                    {item.speed}
                  </small>

                </button>

              ))}

            </div>

            {selectedPreset === 5 && (
              <div className="custom-settings">
                <div className="custom-settings-header">
                  <div>
                    <strong>CUSTOM ROBLOX PLAYBACK RATE</strong>
                  </div>

                  <div className="custom-rate-value">
                    {Number.isFinite(parsedCustomRobloxRate) &&
                    parsedCustomRobloxRate > 0
                      ? parsedCustomRobloxRate.toFixed(2)
                      : "—"}
                  </div>
                </div>

                <div className="custom-slider-row">
                  <input
                    className="custom-slider"
                    type="range"
                    min="0.01"
                    max="20"
                    step="0.01"
                    value={
                      Number.isFinite(parsedCustomRobloxRate) &&
                      parsedCustomRobloxRate > 0
                        ? parsedCustomRobloxRate
                        : 0.43
                    }
                    onChange={(event) => {
                      setCustomRobloxRate(event.target.value);
                      setProcessedFile(null);
                      setError("");
                      setProgress(0);
                    }}
                    disabled={processing}
                    aria-label="Custom Roblox Playback Rate Slider"
                  />

                  <input
                    className="custom-number"
                    type="number"
                    min="0.01"
                    max="20"
                    step="0.01"
                    value={customRobloxRate}
                    onChange={(event) => {
                      setCustomRobloxRate(event.target.value);
                      setProcessedFile(null);
                      setError("");
                      setProgress(0);
                    }}
                    onBlur={() => {
                      if (customRobloxRate === "") {
                        setCustomRobloxRate("0.43");
                        return;
                      }

                      const value = Number(customRobloxRate);

                      if (!Number.isFinite(value) || value <= 0) {
                        setCustomRobloxRate("0.43");
                        return;
                      }

                      setCustomRobloxRate(
                        String(Math.min(20, Math.max(0.01, value)))
                      );
                    }}
                    disabled={processing}
                    aria-label="Custom Roblox Playback Rate Number"
                    placeholder="0.43"
                  />
                </div>
              </div>
            )}

            {/* INFO */}
            <div className="info-grid">

              <div className="info-card">
                <span>SPEED</span>

                <strong>
                  {activeRobloxRate.toFixed(2)}
                </strong>

                <small>
                  ROBLOX TARGET
                </small>
              </div>

              <div className="info-card">
                <span>PITCH</span>

                <strong>
                  LINKED
                </strong>

                <small>
                  WITH SPEED
                </small>
              </div>

              <div className="info-card">
                <span>GAIN</span>

                <strong>
                  -4
                </strong>

                <small>
                  DB
                </small>
              </div>

              <div className="info-card">
                <span>OUTPUT</span>

                <strong>
                  OGG
                </strong>

                <small>
                  MAX 20 MB
                </small>
              </div>

            </div>

            {/* ENGINE STATUS */}
            <div className="engine-status">

              <div className="status-icon" />

              <div>

                <strong>
                  Local Audio Engine
                </strong>

                <p>
                  Audio is processed locally in your browser.
                  Your audio is not uploaded to a server.
                </p>

              </div>

            </div>

            {/* PROCESS BUTTON */}
            <button
              type="button"
              className={`process-button ${
                !selectedFile || processing
                  ? "disabled"
                  : ""
              }`}
              onClick={handleProcess}
              disabled={!selectedFile || processing}
            >

              <span>
                {processing ? "⚙" : "✦"}
              </span>

              {processing
                ? `PROCESSING ${progress}%`
                : "PROCESS AUDIO"}

              <span>
                {processing ? "…" : "→"}
              </span>

            </button>

            {/* PROGRESS */}
            {processing && (
              <div className="processing-progress">

                <div className="progress-track">

                  <div
                    className="progress-fill"
                    style={{
                      width: `${progress}%`,
                    }}
                  />

                </div>

                <div className="progress-text">

                  <span>
                    Processing audio...
                  </span>

                  <strong>
                    {progress}%
                  </strong>

                </div>

              </div>
            )}

            {/* SUCCESS */}
            {processedFile && !processing && (
              <div className="success-result">

                <div className="success-dot" />

                <div>

                  <strong>
                    Audio berhasil diproses
                  </strong>

                  <p>
                    OGG •{" "}
                    {formatBytes(
                      processedFile.size
                    )}
                  </p>

                </div>

              </div>
            )}

            {/* ERROR */}
            {error && (
              <div className="error-result">
                {error}
              </div>
            )}

          </div>

        </section>

        {/* FOOTER */}
        <footer>

          <span>GONAUDIO</span>

          <span>•</span>

          <span>
            AUDIO PROCESSOR V1.0
          </span>

          <span>•</span>

          <span>
            FREE 0/∞
          </span>

          <span>•</span>

          <span>
            PRIVACY
          </span>

          <span>•</span>

          <span>
            TERMS
          </span>

        </footer>

      </main>
    </div>
  );
}

export default App;