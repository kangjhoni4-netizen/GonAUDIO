import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
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

const DEFAULT_CUSTOM_RATE = "0.43";
const CUSTOM_MIN = 0.01;
const CUSTOM_MAX = 20;
const MAX_FILES = 50;

function createId(file, index) {
  return `${file.name}-${file.size}-${file.lastModified}-${index}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function getBaseName(fileName) {
  return (
    fileName
      .replace(/\.[^/.]+$/, "")
      .replace(/[^\w\- ]/g, "")
      .trim() || "audio"
  );
}

function Waveform({ file }) {
  const [bars, setBars] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let audioContext = null;

    const buildWaveform = async () => {
      setLoading(true);

      try {
        const arrayBuffer = await file.arrayBuffer();

        if (cancelled) return;

        audioContext = new AudioContext();
        const audioBuffer = await audioContext.decodeAudioData(
          arrayBuffer.slice(0)
        );

        if (cancelled) return;

        const channelCount = audioBuffer.numberOfChannels;
        const length = audioBuffer.length;
        const barCount = 56;
        const samplesPerBar = Math.max(1, Math.floor(length / barCount));
        const output = [];

        for (let bar = 0; bar < barCount; bar += 1) {
          const start = bar * samplesPerBar;
          const end = Math.min(
            length,
            start + samplesPerBar
          );

          let peak = 0;

          for (let channel = 0; channel < channelCount; channel += 1) {
            const data = audioBuffer.getChannelData(channel);

            for (let i = start; i < end; i += 1) {
              peak = Math.max(peak, Math.abs(data[i]));
            }
          }

          output.push(Math.max(0.08, peak));
        }

        if (!cancelled) {
          setBars(output);
        }
      } catch {
        if (!cancelled) {
          setBars([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }

        if (audioContext) {
          try {
            await audioContext.close();
          } catch {
            // Ignore close errors.
          }
        }
      }
    };

    buildWaveform();

    return () => {
      cancelled = true;
      if (audioContext) {
        try {
          audioContext.close();
        } catch {
          // Ignore close errors.
        }
      }
    };
  }, [file]);

  if (loading) {
    return <div className="waveform waveform-loading" />;
  }

  if (!bars.length) {
    return <div className="waveform waveform-empty" />;
  }

  return (
    <div
      className="waveform"
      aria-label={`Waveform ${file.name}`}
    >
      {bars.map((value, index) => (
        <span
          key={`${file.name}-${index}`}
          style={{ height: `${Math.max(12, value * 100)}%` }}
        />
      ))}
    </div>
  );
}

function PreviewAudio({ file }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!src) {
    return null;
  }

  return (
    <audio
      className="preview-audio"
      controls
      preload="metadata"
      src={src}
    />
  );
}

function App() {
  const fileInputRef = useRef(null);
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const pauseWaitersRef = useRef([]);

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customRobloxRate, setCustomRobloxRate] = useState(
    DEFAULT_CUSTOM_RATE
  );
  const [dragging, setDragging] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalProgress, setTotalProgress] = useState(0);
  const [processingIndex, setProcessingIndex] = useState(0);
  const [batchResults, setBatchResults] = useState([]);
  const [error, setError] = useState("");
  const [previewFileId, setPreviewFileId] = useState(null);
  const [draggedQueueId, setDraggedQueueId] = useState(null);
  const [dragOverQueueId, setDragOverQueueId] = useState(null);

  const preset = PRESETS[selectedPreset];
  const parsedCustomRobloxRate = Number(customRobloxRate);

  const activeRobloxRate =
    selectedPreset === 5
      ? parsedCustomRobloxRate
      : Number(preset.speed);

  const activeProcessingSpeed = 1 / activeRobloxRate;

  useEffect(() => {
    return () => {
      pauseWaitersRef.current.forEach((resolve) => resolve());
      pauseWaitersRef.current = [];
    };
  }, []);

  const isValidAudio = (file) => {
    return (
      file &&
      (file.type.startsWith("audio/") ||
        /\.(mp3|wav|ogg|flac|m4a|mp4)$/i.test(file.name))
    );
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const audioFiles = incoming.filter(isValidAudio);
    const invalidCount = incoming.length - audioFiles.length;

    setError(
      invalidCount
        ? `${invalidCount} file tidak didukung dan dilewati.`
        : ""
    );

    setSelectedFiles((current) => {
      const existingKeys = new Set(
        current.map(
          (item) =>
            `${item.file.name}-${item.file.size}-${item.file.lastModified}`
        )
      );

      const additions = audioFiles
        .filter(
          (file) =>
            !existingKeys.has(
              `${file.name}-${file.size}-${file.lastModified}`
            )
        )
        .slice(0, Math.max(0, MAX_FILES - current.length))
        .map((file, index) => ({
          id: createId(file, current.length + index),
          file,
        }));

      const next = [...current, ...additions];

      if (
        current.length + audioFiles.length > MAX_FILES &&
        !invalidCount
      ) {
        setError(`Maksimal ${MAX_FILES} audio per batch.`);
      }

      return next;
    });

    setBatchResults([]);
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const handleInputChange = (event) => {
    addFiles(event.target.files);
    event.target.value = "";
  };

  const openFilePicker = () => {
    if (!processing) {
      fileInputRef.current?.click();
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) {
      return "0 KB";
    }

    const mb = bytes / 1024 / 1024;

    if (mb >= 1) {
      return `${mb.toFixed(2)} MB`;
    }

    return `${Math.max(
      1,
      Math.round(bytes / 1024)
    )} KB`;
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);

    if (!processing) {
      addFiles(event.dataTransfer.files);
    }
  };

  const removeFile = (id) => {
    if (processing) return;

    setSelectedFiles((current) =>
      current.filter((item) => item.id !== id)
    );

    if (previewFileId === id) {
      setPreviewFileId(null);
    }

    setBatchResults([]);
    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const clearFiles = () => {
    if (processing) return;

    setSelectedFiles([]);
    setPreviewFileId(null);
    setBatchResults([]);
    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const moveQueueItem = (id, direction) => {
    if (processing) return;

    setSelectedFiles((current) => {
      const index = current.findIndex((item) => item.id === id);

      if (index === -1) {
        return current;
      }

      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = [...current];
      const [movedItem] = next.splice(index, 1);
      next.splice(nextIndex, 0, movedItem);

      return next;
    });

    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const handleQueueDragStart = (event, id) => {
    if (processing) return;

    setDraggedQueueId(id);
    setDragOverQueueId(null);

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
    }
  };

  const handleQueueDragOver = (event, id) => {
    if (processing || !draggedQueueId || draggedQueueId === id) {
      return;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    setDragOverQueueId(id);
  };

  const handleQueueDrop = (event, targetId) => {
    event.preventDefault();

    if (
      processing ||
      !draggedQueueId ||
      draggedQueueId === targetId
    ) {
      setDraggedQueueId(null);
      setDragOverQueueId(null);
      return;
    }

    setSelectedFiles((current) => {
      const fromIndex = current.findIndex(
        (item) => item.id === draggedQueueId
      );
      const toIndex = current.findIndex(
        (item) => item.id === targetId
      );

      if (
        fromIndex === -1 ||
        toIndex === -1 ||
        fromIndex === toIndex
      ) {
        return current;
      }

      const next = [...current];
      const [movedItem] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, movedItem);

      return next;
    });

    setDraggedQueueId(null);
    setDragOverQueueId(null);
    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const handleQueueDragEnd = () => {
    setDraggedQueueId(null);
    setDragOverQueueId(null);
  };

  const clearDone = () => {
    if (processing) return;

    const doneIds = new Set(
      batchResults
        .filter((item) => item.status === "done")
        .map((item) => item.id)
    );

    if (!doneIds.size) {
      return;
    }

    setSelectedFiles((current) =>
      current.filter((item) => !doneIds.has(item.id))
    );

    setBatchResults((current) =>
      current.filter((item) => !doneIds.has(item.id))
    );

    if (previewFileId && doneIds.has(previewFileId)) {
      setPreviewFileId(null);
    }

    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const retryQueueItem = async (id) => {
    if (processing) return;

    const item = selectedFiles.find(
      (queueItem) => queueItem.id === id
    );

    if (!item) {
      return;
    }

    if (
      !Number.isFinite(activeRobloxRate) ||
      activeRobloxRate <= 0 ||
      !Number.isFinite(activeProcessingSpeed) ||
      activeProcessingSpeed <= 0
    ) {
      setError("Target playback rate Roblox tidak valid.");
      return;
    }

    cancelRef.current = false;
    pauseRef.current = false;

    const itemIndex = selectedFiles.findIndex(
      (queueItem) => queueItem.id === id
    );

    setProcessing(true);
    setPaused(false);
    setCancelRequested(false);
    setError("");
    setProcessingIndex(Math.max(0, itemIndex));
    setProgress(0);
    setTotalProgress(0);

    setBatchResults((current) =>
      current.map((result) =>
        result.id === id
          ? {
              ...result,
              status: "processing",
              error: "",
            }
          : result
      )
    );

    const safePresetName = preset.name.replace(
      /\s+/g,
      "_"
    );

    try {
      const result = await processAudio(
        item.file,
        activeProcessingSpeed,
        (fileProgress) => {
          const numericProgress = Number(fileProgress) || 0;
          setProgress(numericProgress);
          setTotalProgress(numericProgress);
        },
        {
          signal: {
            get aborted() {
              return cancelRef.current;
            },
          },
        }
      );

      if (cancelRef.current) {
        return;
      }

      const outputName = `${getBaseName(
        item.file.name
      )}_GonAUDIO_${safePresetName}.ogg`;

      downloadBlob(result.blob, outputName);

      setBatchResults((current) =>
        current.map((resultItem) =>
          resultItem.id === id
            ? {
                ...resultItem,
                status: "done",
                outputName,
                size: result.size,
                blob: result.blob,
                error: "",
              }
            : resultItem
        )
      );

      setProgress(100);
      setTotalProgress(100);
    } catch (retryError) {
      if (retryError?.name === "AbortError") {
        setBatchResults((current) =>
          current.map((result) =>
            result.id === id
              ? {
                  ...result,
                  status: "cancelled",
                }
              : result
          )
        );

        setError("Retry dibatalkan.");
      } else {
        console.error(retryError);

        setBatchResults((current) =>
          current.map((result) =>
            result.id === id
              ? {
                  ...result,
                  status: "error",
                  error:
                    retryError?.message ||
                    "Retry gagal memproses audio.",
                }
              : result
          )
        );

        setError(
          retryError?.message ||
            "Retry gagal memproses audio."
        );
      }
    } finally {
      const wasCanceled = cancelRef.current;

      setProcessing(false);
      setPaused(false);
      setCancelRequested(false);
      setProcessingIndex(0);
      setProgress(wasCanceled ? 0 : 100);
      setTotalProgress(wasCanceled ? 0 : 100);

      pauseRef.current = false;
      cancelRef.current = false;
      resumePauseWaiters();
    }
  };

  const getQueueStatus = (id) => {
    return (
      batchResults.find((item) => item.id === id)?.status ||
      "waiting"
    );
  };

  const handlePresetChange = (index) => {
    if (processing) return;

    setSelectedPreset(index);
    setBatchResults([]);
    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const updateCustomRate = (value) => {
    setCustomRobloxRate(value);
    setBatchResults([]);
    setError("");
    setProgress(0);
    setTotalProgress(0);
  };

  const waitWhilePaused = async () => {
    while (pauseRef.current && !cancelRef.current) {
      await new Promise((resolve) => {
        pauseWaitersRef.current.push(resolve);
      });
    }

    if (cancelRef.current) {
      const error = new Error("Batch processing dibatalkan.");
      error.name = "AbortError";
      throw error;
    }
  };

  const resumePauseWaiters = () => {
    const waiters = pauseWaitersRef.current.splice(0);
    waiters.forEach((resolve) => resolve());
  };

  const pauseBatch = () => {
    if (!processing) return;

    pauseRef.current = true;
    setPaused(true);
  };

  const resumeBatch = () => {
    pauseRef.current = false;
    setPaused(false);
    resumePauseWaiters();
  };

  const cancelBatch = () => {
    if (!processing) return;

    cancelRef.current = true;
    pauseRef.current = false;
    setCancelRequested(true);
    setPaused(false);
    resumePauseWaiters();
  };

  const downloadAllAsZip = async () => {
    const doneResults = batchResults.filter(
      (item) => item.status === "done" && item.blob
    );

    if (!doneResults.length) {
      setError("Belum ada hasil OGG yang bisa dimasukkan ke ZIP.");
      return;
    }

    try {
      setError("");

      const zip = new JSZip();

      doneResults.forEach((item) => {
        zip.file(item.outputName, item.blob);
      });

      const zipBlob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });

      downloadBlob(
        zipBlob,
        `GonAUDIO_${PRESETS[selectedPreset].name.replace(
          /\s+/g,
          "_"
        )}_BATCH.zip`
      );
    } catch (err) {
      console.error(err);
      setError(
        err?.message || "Gagal membuat file ZIP."
      );
    }
  };

  const handleProcess = async () => {
    if (!selectedFiles.length) {
      setError("Upload audio terlebih dahulu.");
      return;
    }

    if (processing) {
      return;
    }

    if (
      !Number.isFinite(activeRobloxRate) ||
      activeRobloxRate <= 0 ||
      !Number.isFinite(activeProcessingSpeed) ||
      activeProcessingSpeed <= 0
    ) {
      setError("Target playback rate Roblox tidak valid.");
      return;
    }

    cancelRef.current = false;
    pauseRef.current = false;

    setProcessing(true);
    setPaused(false);
    setCancelRequested(false);
    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);

    const initialResults = selectedFiles.map((item) => ({
      id: item.id,
      fileName: item.file.name,
      outputName: "",
      status: "waiting",
      size: 0,
      blob: null,
      error: "",
    }));

    setBatchResults(initialResults);

    const safePresetName = preset.name.replace(/\s+/g, "_");

    try {
      for (let index = 0; index < selectedFiles.length; index += 1) {
        await waitWhilePaused();

        if (cancelRef.current) {
          break;
        }

        const item = selectedFiles[index];
        const file = item.file;

        setProcessingIndex(index);
        setBatchResults((current) =>
          current.map((result) =>
            result.id === item.id
              ? {
                  ...result,
                  status: "processing",
                  error: "",
                }
              : result
          )
        );

        setProgress(0);
        setTotalProgress(
          Math.round((index / selectedFiles.length) * 100)
        );

        try {
          const result = await processAudio(
            file,
            activeProcessingSpeed,
            (fileProgress) => {
              const numericProgress = Number(fileProgress) || 0;

              setProgress(numericProgress);

              const batchProgress =
                ((index + numericProgress / 100) /
                  selectedFiles.length) *
                100;

              setTotalProgress(
                Math.min(100, Math.round(batchProgress))
              );
            },
            {
              signal: {
                get aborted() {
                  return cancelRef.current;
                },
              },
            }
          );

          if (cancelRef.current) {
            break;
          }

          const outputName = `${getBaseName(
            file.name
          )}_GonAUDIO_${safePresetName}.ogg`;

          setBatchResults((current) =>
            current.map((resultItem) =>
              resultItem.id === item.id
                ? {
                    ...resultItem,
                    status: "done",
                    outputName,
                    size: result.size,
                    blob: result.blob,
                    error: "",
                  }
                : resultItem
            )
          );
        } catch (fileError) {
          if (fileError?.name === "AbortError") {
            break;
          }

          console.error(fileError);

          setBatchResults((current) =>
            current.map((resultItem) =>
              resultItem.id === item.id
                ? {
                    ...resultItem,
                    status: "error",
                    error:
                      fileError?.message ||
                      "Terjadi kesalahan saat memproses audio.",
                  }
                : resultItem
            )
          );
        }
      }

      if (cancelRef.current) {
        setBatchResults((current) =>
          current.map((item) =>
            item.status === "waiting" || item.status === "processing"
              ? {
                  ...item,
                  status: "cancelled",
                }
              : item
          )
        );

        setTotalProgress((current) => current);
        setError("Batch processing dibatalkan.");
      } else {
        setProgress(100);
        setTotalProgress(100);
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("Batch processing dibatalkan.");
      } else {
        console.error(err);
        setError(
          err?.message ||
            "Terjadi kesalahan saat memproses batch audio."
        );
      }
    } finally {
      setProcessing(false);
      setPaused(false);
      setCancelRequested(false);
      setProcessingIndex(0);
      pauseRef.current = false;
      cancelRef.current = false;
      resumePauseWaiters();
    }
  };

  const activePreviewItem =
    selectedFiles.find((item) => item.id === previewFileId) || null;

  const doneCount = batchResults.filter(
    (item) => item.status === "done"
  ).length;

  const hasDoneResults = doneCount > 0;

  return (
    <div className="app">
      <div className="background-glow glow-one" />
      <div className="background-glow glow-two" />

      <main className="container">
        {/* HERO */}
        <section className="hero">
          <div className="version-badge">
            <span className="badge-dot" />
            AUDIO PROCESSING V2.0
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
              className={`upload-box ${dragging ? "dragging" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();

                if (!processing) {
                  setDragging(true);
                }
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
                multiple
                hidden
              />

              <div className="upload-icon" />

              <h2>Upload your audio</h2>

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
            </div>

            {/* QUEUE */}
            <div className="queue-panel">
              <div className="queue-panel-header">
                <div>
                  <strong>
                    QUEUE • {selectedFiles.length} TRACK
                    {selectedFiles.length === 1 ? "" : "S"}
                  </strong>

                  <small>
                    {batchResults.length
                      ? `${batchResults.filter(
                          (item) => item.status === "done"
                        ).length} DONE • ${batchResults.filter(
                          (item) => item.status === "processing"
                        ).length} PROCESSING • ${batchResults.filter(
                          (item) => item.status === "waiting"
                        ).length} WAITING • ${batchResults.filter(
                          (item) => item.status === "error"
                        ).length} ERROR`
                      : "Drag the handle to reorder the Queue."}
                  </small>
                </div>

                <div className="queue-header-actions">
                  <button
                    type="button"
                    className="clear-done-button"
                    onClick={clearDone}
                    disabled={
                      processing ||
                      !batchResults.some(
                        (item) => item.status === "done"
                      )
                    }
                  >
                    CLEAR DONE
                  </button>

                  <button
                    type="button"
                    className="add-more-button"
                    onClick={openFilePicker}
                    disabled={processing}
                  >
                    + ADD TO QUEUE
                  </button>
                </div>
              </div>

              {selectedFiles.length > 0 ? (
                <>
                  <div className="queue-list">
                    {selectedFiles.map((item, index) => {
                      const status = getQueueStatus(item.id);

                      return (
                        <div
                          className={`queue-item ${
                            previewFileId === item.id
                              ? "preview-active"
                              : ""
                          } ${
                            dragOverQueueId === item.id
                              ? "drag-over"
                              : ""
                          } ${status}`}
                          key={item.id}
                          onDragOver={(event) =>
                            handleQueueDragOver(event, item.id)
                          }
                          onDrop={(event) =>
                            handleQueueDrop(event, item.id)
                          }
                        >
                          <span
                            className={`queue-drag-handle ${
                              draggedQueueId === item.id
                                ? "dragging"
                                : ""
                            }`}
                            draggable={!processing}
                            onDragStart={(event) =>
                              handleQueueDragStart(
                                event,
                                item.id
                              )
                            }
                            onDragEnd={handleQueueDragEnd}
                            title="Drag to reorder"
                          >
                            ⋮⋮
                          </span>

                          <span className="queue-index">
                            {index + 1}
                          </span>

                          <button
                            type="button"
                            className="file-main"
                            onClick={() =>
                              setPreviewFileId((current) =>
                                current === item.id
                                  ? null
                                  : item.id
                              )
                            }
                            title="Preview audio"
                          >
                            <span className="file-play-icon">
                              {previewFileId === item.id
                                ? "❚❚"
                                : "▶"}
                            </span>

                            <span className="file-text">
                              <strong title={item.file.name}>
                                {item.file.name}
                              </strong>

                              <small>
                                {formatSize(item.file.size)}
                              </small>
                            </span>
                          </button>

                          <span className={`queue-status ${status}`}>
                            {status === "done"
                              ? "DONE"
                              : status === "error"
                                ? "ERROR"
                                : status === "processing"
                                  ? "PROCESSING"
                                  : status === "cancelled"
                                    ? "CANCELLED"
                                    : "WAITING"}
                          </span>

                          <div className="queue-reorder">
                            <button
                              type="button"
                              className="queue-arrow"
                              onClick={() =>
                                moveQueueItem(item.id, -1)
                              }
                              disabled={
                                processing || index === 0
                              }
                              aria-label={`Move ${item.file.name} up`}
                            >
                              ↑
                            </button>

                            <button
                              type="button"
                              className="queue-arrow"
                              onClick={() =>
                                moveQueueItem(item.id, 1)
                              }
                              disabled={
                                processing ||
                                index === selectedFiles.length - 1
                              }
                              aria-label={`Move ${item.file.name} down`}
                            >
                              ↓
                            </button>
                          </div>

                          <button
                            type="button"
                            className="remove-file"
                            onClick={() => removeFile(item.id)}
                            disabled={processing}
                            aria-label={`Remove ${item.file.name}`}
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {activePreviewItem && (
                    <div
                      className="batch-preview"
                      onClick={(event) =>
                        event.stopPropagation()
                      }
                    >
                      <div className="batch-preview-header">
                        <strong>PREVIEW</strong>

                        <span>
                          {activePreviewItem.file.name}
                        </span>
                      </div>

                      <Waveform file={activePreviewItem.file} />

                      <PreviewAudio
                        file={activePreviewItem.file}
                      />
                    </div>
                  )}

                  <div className="upload-actions">
                    <button
                      type="button"
                      className="clear-files-button"
                      onClick={clearFiles}
                      disabled={processing}
                    >
                      CLEAR ALL
                    </button>
                  </div>
                </>
              ) : (
                <div className="queue-empty">
                  <span>QUEUE EMPTY</span>
                  <small>
                    Upload audio untuk menambah track ke Queue.
                  </small>
                </div>
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
                    selectedPreset === index ? "active" : ""
                  }`}
                  onClick={() => handlePresetChange(index)}
                  disabled={processing}
                >
                  <span className="preset-number">
                    {index + 1}
                  </span>

                  <strong>{item.name}</strong>

                  <small>{item.speed}</small>
                </button>
              ))}
            </div>

            {selectedPreset === 5 && (
              <div className="custom-settings">
                <div className="custom-settings-header">
                  <strong>CUSTOM ROBLOX PLAYBACK RATE</strong>

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
                    min={CUSTOM_MIN}
                    max={CUSTOM_MAX}
                    step="0.01"
                    value={
                      Number.isFinite(parsedCustomRobloxRate) &&
                      parsedCustomRobloxRate > 0
                        ? Math.min(
                            CUSTOM_MAX,
                            Math.max(
                              CUSTOM_MIN,
                              parsedCustomRobloxRate
                            )
                          )
                        : 0.43
                    }
                    onChange={(event) =>
                      updateCustomRate(event.target.value)
                    }
                    disabled={processing}
                    aria-label="Custom Roblox Playback Rate Slider"
                  />

                  <input
                    className="custom-number"
                    type="number"
                    min={CUSTOM_MIN}
                    max={CUSTOM_MAX}
                    step="0.01"
                    value={customRobloxRate}
                    onChange={(event) =>
                      updateCustomRate(event.target.value)
                    }
                    onBlur={() => {
                      if (customRobloxRate === "") {
                        setCustomRobloxRate(DEFAULT_CUSTOM_RATE);
                        return;
                      }

                      const value = Number(customRobloxRate);

                      if (!Number.isFinite(value) || value <= 0) {
                        setCustomRobloxRate(DEFAULT_CUSTOM_RATE);
                        return;
                      }

                      setCustomRobloxRate(
                        String(
                          Math.min(
                            CUSTOM_MAX,
                            Math.max(CUSTOM_MIN, value)
                          )
                        )
                      );
                    }}
                    disabled={processing}
                    aria-label="Custom Roblox Playback Rate Number"
                    placeholder={DEFAULT_CUSTOM_RATE}
                  />
                </div>
              </div>
            )}

            {/* INFO */}
            <div className="info-grid">
              <div className="info-card">
                <span>SPEED</span>

                <strong>
                  {Number.isFinite(activeRobloxRate)
                    ? activeRobloxRate.toFixed(2)
                    : "—"}
                </strong>

                <small>ROBLOX TARGET</small>
              </div>

              <div className="info-card">
                <span>PITCH</span>

                <strong>LINKED</strong>

                <small>WITH SPEED</small>
              </div>

              <div className="info-card">
                <span>GAIN</span>

                <strong>-4</strong>

                <small>DB</small>
              </div>

              <div className="info-card">
                <span>OUTPUT</span>

                <strong>OGG</strong>

                <small>MAX 20 MB</small>
              </div>
            </div>

            {/* ENGINE STATUS */}
            <div className="engine-status">
              <div className="status-icon" />

              <div>
                <strong>Local Audio Engine</strong>

                <p>
                  Audio is processed locally in your browser.
                  Your audio is not uploaded to a server.
                </p>
              </div>
            </div>

            {/* TOTAL PROGRESS */}
            {processing && (
              <div className="batch-progress-panel">
                <div className="batch-progress-header">
                  <div>
                    <strong>
                      FILE {Math.min(
                        processingIndex + 1,
                        selectedFiles.length
                      )} / {selectedFiles.length}
                    </strong>

                    <span>
                      {paused
                        ? "PAUSED"
                        : cancelRequested
                          ? "CANCELING..."
                          : "PROCESSING"}
                    </span>
                  </div>

                  <strong>{totalProgress}%</strong>
                </div>

                <div className="progress-track total-progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${totalProgress}%`,
                    }}
                  />
                </div>

                <div className="progress-track current-progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${progress}%`,
                    }}
                  />
                </div>

                <div className="progress-text batch-progress-text">
                  <span>
                    CURRENT {progress}%
                  </span>

                  <span>
                    {paused ? "RESUME TO CONTINUE" : "BATCH TOTAL"}
                  </span>
                </div>

                <div className="batch-controls">
                  {paused ? (
                    <button
                      type="button"
                      className="batch-control-button"
                      onClick={resumeBatch}
                    >
                      ▶ RESUME
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="batch-control-button"
                      onClick={pauseBatch}
                    >
                      ❚❚ PAUSE
                    </button>
                  )}

                  <button
                    type="button"
                    className="batch-control-button danger"
                    onClick={cancelBatch}
                  >
                    ■ CANCEL
                  </button>
                </div>
              </div>
            )}

            {/* PROCESS BUTTON */}
            <button
              type="button"
              className={`process-button ${
                !selectedFiles.length || processing
                  ? "disabled"
                  : ""
              }`}
              onClick={handleProcess}
              disabled={!selectedFiles.length || processing}
            >
              <span>{processing ? "⚙" : "✦"}</span>

              {processing
                ? `PROCESSING ${
                    processingIndex + 1
                  }/${selectedFiles.length}`
                : `PROCESS QUEUE • ${selectedFiles.length}` }

              <span>{processing ? "…" : "→"}</span>
            </button>

            {/* QUEUE RESULTS */}
            {batchResults.length > 0 && !processing && (
              <div className="batch-results">
                <div className="batch-results-header">
                  <div>
                    <strong>PROCESSING RESULTS</strong>

                    <span>
                      {doneCount}/{batchResults.length} DONE
                    </span>
                  </div>

                  <div className="result-header-actions">
                    {batchResults.some(
                      (item) => item.status === "error"
                    ) && (
                      <span className="retry-hint">
                        FAILED TRACKS CAN BE RETRIED
                      </span>
                    )}

                    {hasDoneResults && (
                      <button
                        type="button"
                        className="zip-button"
                        onClick={downloadAllAsZip}
                      >
                        ↓ DOWNLOAD ALL ZIP
                      </button>
                    )}
                  </div>
                </div>

                <div className="batch-results-list">
                  {batchResults.map((item) => (
                    <div
                      className={`batch-result-item ${item.status}`}
                      key={item.id}
                    >
                      <span className="batch-result-status">
                        {item.status === "done"
                          ? "✓"
                          : item.status === "error"
                            ? "!"
                            : item.status === "cancelled"
                              ? "×"
                              : "•"}
                      </span>

                      <div className="batch-result-name">
                        <strong title={item.fileName}>
                          {item.fileName}
                        </strong>

                        <small>
                          {item.status === "done"
                            ? `OGG • ${formatBytes(item.size)}`
                            : item.status === "error"
                              ? item.error
                              : item.status.toUpperCase()}
                        </small>
                      </div>

                      {item.status === "error" && (
                        <button
                          type="button"
                          className="retry-button"
                          onClick={() =>
                            retryQueueItem(item.id)
                          }
                          disabled={processing}
                        >
                          RETRY
                        </button>
                      )}
                    </div>
                  ))}
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

        <footer>
          <span>GONAUDIO</span>
          <span>•</span>
          <span>AUDIO PROCESSOR V2.0</span>
          <span>•</span>
          <span>FREE 0/∞</span>
          <span>•</span>
          <span>PRIVACY</span>
          <span>•</span>
          <span>TERMS</span>
        </footer>
      </main>
    </div>
  );
}

export default App;
