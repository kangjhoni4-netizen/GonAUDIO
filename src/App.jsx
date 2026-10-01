import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import FingerprintJS from "@fingerprintjs/fingerprintjs";
import "./App.css";

import {
  processAudio,
  downloadBlob,
  formatBytes,
} from "./audioProcessor";

import { supabase } from "./lib/supabaseClient";

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
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "0x4AAAAAAFK2H6hFanUq099w";
const TURNSTILE_ACTION = "process_audio";
const DEVICE_QUOTA_FUNCTION = "device-quota";
const FREE_DAILY_LIMIT = 10;

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

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector(
      'script[data-gonaudio-turnstile="true"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", () => {
        if (window.turnstile) resolve(window.turnstile);
        else reject(new Error("Cloudflare Turnstile tidak tersedia."));
      });
      existingScript.addEventListener("error", () => {
        reject(new Error("Gagal memuat Cloudflare Turnstile."));
      });
      return;
    }

    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.gonaudioTurnstile = "true";

    script.onload = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error("Cloudflare Turnstile tidak tersedia."));
      }
    };

    script.onerror = () => {
      reject(new Error("Gagal memuat Cloudflare Turnstile."));
    };

    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
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
  const [queueStatusById, setQueueStatusById] = useState({});
  const [selectedResultIds, setSelectedResultIds] = useState([]);

  const [deviceFingerprint, setDeviceFingerprint] = useState("");
  const [deviceReady, setDeviceReady] = useState(false);
  const [deviceLoading, setDeviceLoading] = useState(true);
  const [deviceError, setDeviceError] = useState("");
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaUsed, setQuotaUsed] = useState(0);
  const [quotaRemaining, setQuotaRemaining] = useState(0);
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileError, setTurnstileError] = useState("");
  const [error, setError] = useState("");
  const turnstileContainerRef = useRef(null);
  const turnstileWidgetIdRef = useRef(null);
  const turnstileResolverRef = useRef(null);
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
    let mounted = true;

    loadTurnstileScript()
      .then((turnstile) => {
        if (!mounted || !turnstileContainerRef.current) return;

        const widgetId = turnstile.render(
          turnstileContainerRef.current,
          {
            sitekey: TURNSTILE_SITE_KEY,
            theme: "dark",
            size: "flexible",
            appearance: "interaction-only",
            execution: "execute",
            action: TURNSTILE_ACTION,
            callback: (token) => {
              setTurnstileReady(true);
              const resolve = turnstileResolverRef.current;
              turnstileResolverRef.current = null;
              resolve?.(token);
            },
            "expired-callback": () => {
              setTurnstileReady(false);
              const reject = turnstileResolverRef.current;
              turnstileResolverRef.current = null;
              reject?.(
                new Error(
                  "Verifikasi keamanan kedaluwarsa. Coba lagi."
                )
              );
            },
            "error-callback": () => {
              setTurnstileReady(false);
              const reject = turnstileResolverRef.current;
              turnstileResolverRef.current = null;
              reject?.(
                new Error(
                  "Verifikasi Cloudflare gagal. Coba lagi."
                )
              );
            },
          }
        );

        if (mounted) {
          turnstileWidgetIdRef.current = widgetId;
          setTurnstileReady(true);
        }
      })
      .catch((error) => {
        console.error(error);
        if (mounted) {
          setTurnstileReady(false);
          setTurnstileError(
            error?.message ||
              "Cloudflare Turnstile tidak dapat dimuat."
          );
        }
      });

    return () => {
      mounted = false;
      turnstileResolverRef.current = null;

      if (
        window.turnstile &&
        turnstileWidgetIdRef.current !== null
      ) {
        try {
          window.turnstile.remove(
            turnstileWidgetIdRef.current
          );
        } catch {
          // Ignore cleanup errors.
        }
      }

      turnstileWidgetIdRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      pauseWaitersRef.current.forEach((resolve) => resolve());
      pauseWaitersRef.current = [];
    };
  }, []);


  const callDeviceQuota = async (
    action,
    fingerprint = deviceFingerprint,
    turnstileToken = ""
  ) => {
    if (!fingerprint) {
      throw new Error(
        "Device fingerprint belum siap."
      );
    }

    const { data, error: functionError } =
      await supabase.functions.invoke(
        DEVICE_QUOTA_FUNCTION,
        {
          body: {
            action,
            visitorId: fingerprint,
            turnstileToken,
          },
        }
      );

    if (functionError) {
      throw functionError;
    }

    if (!data) {
      throw new Error(
        "Server quota tidak mengembalikan data."
      );
    }

    return data;
  };

  const loadQuota = async (
    currentFingerprint = deviceFingerprint
  ) => {
    if (!currentFingerprint) {
      return null;
    }

    setQuotaLoading(true);

    try {
      const data = await callDeviceQuota(
        "get",
        currentFingerprint
      );

      if (!data.success) {
        throw new Error(
          data.message ||
            "Gagal mengambil quota dari server."
        );
      }

      const used = Math.max(
        0,
        Number(data.used) || 0
      );

      const remaining = Math.max(
        0,
        Number(data.remaining) || 0
      );

      setQuotaUsed(used);
      setQuotaRemaining(remaining);
      setDeviceError("");

      return {
        used,
        remaining,
        limit:
          Number(data.limit) ||
          FREE_DAILY_LIMIT,
      };
    } catch (quotaError) {
      console.error(quotaError);

      setDeviceError(
        quotaError?.message ||
          "Gagal mengambil quota dari server."
      );

      return null;
    } finally {
      setQuotaLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const initializeDevice = async () => {
      setDeviceLoading(true);
      setDeviceError("");

      try {
        const agent = await FingerprintJS.load({
          monitoring: false,
        });

        const result = await agent.get();

        if (!result?.visitorId) {
          throw new Error(
            "Fingerprint browser tidak tersedia."
          );
        }

        if (!mounted) return;

        setDeviceFingerprint(result.visitorId);
        setDeviceReady(true);

        await loadQuota(result.visitorId);
      } catch (error) {
        console.error(error);

        if (!mounted) return;

        setDeviceReady(false);
        setDeviceError(
          error?.message ||
            "Gagal mengidentifikasi device."
        );
      } finally {
        if (mounted) {
          setDeviceLoading(false);
        }
      }
    };

    initializeDevice();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!deviceFingerprint) {
      return;
    }

    loadQuota(deviceFingerprint);

    const intervalId = window.setInterval(
      () => {
        loadQuota(deviceFingerprint);
      },
      60 * 1000
    );

    return () => {
      window.clearInterval(intervalId);
    };
  }, [deviceFingerprint]);

  const getTurnstileToken = async () => {
    if (!window.turnstile) {
      throw new Error(
        "Cloudflare Turnstile belum siap. Refresh halaman dan coba lagi."
      );
    }

    const widgetId = turnstileWidgetIdRef.current;

    if (widgetId === null) {
      throw new Error(
        "Security widget belum siap. Refresh halaman dan coba lagi."
      );
    }

    setTurnstileError("");
    setTurnstileReady(false);

    window.turnstile.reset(widgetId);

    return await new Promise((resolve, reject) => {
      turnstileResolverRef.current = (token) => {
        if (!token) {
          reject(
            new Error(
              "Token keamanan tidak valid. Coba lagi."
            )
          );
          return;
        }
        resolve(token);
      };

      try {
        window.turnstile.execute(widgetId);
      } catch (error) {
        turnstileResolverRef.current = null;
        reject(error);
      }
    });
  };

  const consumeQuota = async (turnstileToken) => {
    const data = await callDeviceQuota(
      "consume",
      deviceFingerprint,
      turnstileToken
    );

    if (!data.success) {
      const used = Math.max(
        0,
        Number(data.used) || 0
      );
      const remaining = Math.max(
        0,
        Number(data.remaining) || 0
      );

      setQuotaUsed(used);
      setQuotaRemaining(remaining);

      return {
        success: false,
        used,
        remaining,
      };
    }

    const used = Math.max(
      0,
      Number(data.used) || 0
    );
    const remaining = Math.max(
      0,
      Number(data.remaining) || 0
    );

    setQuotaUsed(used);
    setQuotaRemaining(remaining);

    return {
      success: true,
      used,
      remaining,
    };
  };

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
    setSelectedResultIds([]);
    setQueueStatusById({});
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

    setQueueStatusById((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    setSelectedResultIds((current) =>
      current.filter((resultId) => resultId !== id)
    );

    setBatchResults((current) =>
      current.filter((result) => result.id !== id)
    );
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
    setQueueStatusById({});
    setSelectedResultIds([]);
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

    setSelectedResultIds((current) =>
      current.filter((resultId) => !doneIds.has(resultId))
    );

    setQueueStatusById((current) => {
      const next = { ...current };

      doneIds.forEach((id) => {
        delete next[id];
      });

      return next;
    });

    if (previewFileId && doneIds.has(previewFileId)) {
      setPreviewFileId(null);
    }

    setError("");
    setProgress(0);
    setTotalProgress(0);
    setProcessingIndex(0);
  };

  const getDoneResults = () => {
    return batchResults.filter(
      (item) => item.status === "done" && item.blob
    );
  };

  const toggleResultSelection = (id) => {
    setSelectedResultIds((current) =>
      current.includes(id)
        ? current.filter((resultId) => resultId !== id)
        : [...current, id]
    );
  };

  const selectAllDoneResults = () => {
    const doneIds = getDoneResults().map((item) => item.id);

    setSelectedResultIds((current) => {
      const allSelected =
        doneIds.length > 0 &&
        doneIds.every((id) => current.includes(id)) &&
        current.length === doneIds.length;

      return allSelected ? [] : doneIds;
    });
  };

  const downloadResult = (item) => {
    if (!item?.blob || !item?.outputName) {
      return;
    }

    downloadBlob(item.blob, item.outputName);
  };

  const createZipBlob = async (items) => {
    const zip = new JSZip();
    const usedNames = new Map();

    items.forEach((item) => {
      const originalName = item.outputName;
      const dotIndex = originalName.lastIndexOf(".");
      const base =
        dotIndex > 0
          ? originalName.slice(0, dotIndex)
          : originalName;
      const extension =
        dotIndex > 0
          ? originalName.slice(dotIndex)
          : "";

      const count = usedNames.get(originalName) || 0;
      usedNames.set(originalName, count + 1);

      const uniqueName =
        count === 0
          ? originalName
          : `${base} (${count + 1})${extension}`;

      zip.file(uniqueName, item.blob);
    });

    return await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  };

  const downloadSelectedAsZip = async () => {
    const selected = getDoneResults().filter((item) =>
      selectedResultIds.includes(item.id)
    );

    if (!selected.length) {
      setError("Pilih minimal satu hasil untuk di-download.");
      return;
    }

    try {
      setError("");

      const zipBlob = await createZipBlob(selected);

      downloadBlob(
        zipBlob,
        `GonAUDIO_SELECTED_${selected.length}.zip`
      );
    } catch (err) {
      console.error(err);
      setError(
        err?.message || "Gagal membuat ZIP pilihan."
      );
    }
  };

  const downloadAllAsZip = async () => {
    const doneResults = getDoneResults();

    if (!doneResults.length) {
      setError("Belum ada hasil OGG yang bisa dimasukkan ke ZIP.");
      return;
    }

    try {
      setError("");

      const zipBlob = await createZipBlob(doneResults);

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

  const clearResults = () => {
    if (processing) return;

    setBatchResults([]);
    setSelectedResultIds([]);
    setError("");
  };

  const retryQueueItem = async (id) => {
    if (processing) return;

    if (!deviceReady || !deviceFingerprint) {
      setDeviceError(
        "Device identification belum siap. Coba refresh halaman."
      );
      return;
    }

    const liveQuota = await loadQuota();

    if (!liveQuota || liveQuota.remaining <= 0) {
      setError(
        "Kuota gratis hari ini sudah habis. Reset setiap 00:00 WIB."
      );
      return;
    }

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

    setQueueStatusById((current) => ({
      ...current,
      [id]: "processing",
    }));

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

      const turnstileToken = await getTurnstileToken();

      const retryQuotaResult = await consumeQuota(
        turnstileToken
      );

      if (!retryQuotaResult.success) {
        setQueueStatusById((current) => ({
          ...current,
          [id]: "waiting",
        }));

        setBatchResults((current) =>
          current.map((resultItem) =>
            resultItem.id === id
              ? {
                  ...resultItem,
                  status: "waiting",
                }
              : resultItem
          )
        );

        setError(
          "Kuota gratis hari ini sudah habis. Reset setiap 00:00 WIB."
        );

        return;
      }

      downloadBlob(result.blob, outputName);

      setQueueStatusById((current) => ({
        ...current,
        [id]: "done",
      }));

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
        setQueueStatusById((current) => ({
          ...current,
          [id]: "cancelled",
        }));

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

        setQueueStatusById((current) => ({
          ...current,
          [id]: "error",
        }));

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
      queueStatusById[id] ||
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

  const handleProcess = async () => {
    if (!deviceReady || !deviceFingerprint) {
      setDeviceError(
        "Device identification belum siap. Coba refresh halaman."
      );
      return;
    }

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

    const liveQuota = await loadQuota();

    if (!liveQuota || liveQuota.remaining <= 0) {
      setError(
        "Kuota gratis hari ini sudah habis. Reset setiap 00:00 WIB."
      );
      return;
    }

    const processableItems = selectedFiles.slice(
      0,
      liveQuota.remaining
    );

    if (
      processableItems.length <
      selectedFiles.length
    ) {
      setError(
        `Sisa quota ${liveQuota.remaining}x. Hanya ${processableItems.length} audio yang diproses pada batch ini.`
      );
    } else {
      setError("");
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
    setSelectedResultIds([]);

    const initialStatus = Object.fromEntries(
      selectedFiles.map((item) => [item.id, "waiting"])
    );

    setQueueStatusById(initialStatus);

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
      for (
        let index = 0;
        index < processableItems.length;
        index += 1
      ) {
        await waitWhilePaused();

        if (cancelRef.current) {
          break;
        }

        const item = processableItems[index];
        const file = item.file;

        setProcessingIndex(index);
        setQueueStatusById((current) => ({
          ...current,
          [item.id]: "processing",
        }));

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
          Math.round(
            (index / processableItems.length) * 100
          )
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
                  processableItems.length) *
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

          const turnstileToken = await getTurnstileToken();

          const quotaResult = await consumeQuota(
            turnstileToken
          );

          if (!quotaResult.success) {
            setQueueStatusById((current) => ({
              ...current,
              [item.id]: "waiting",
            }));

            setBatchResults((current) =>
              current.map((resultItem) =>
                resultItem.id === item.id
                  ? {
                      ...resultItem,
                      status: "waiting",
                    }
                  : resultItem
              )
            );

            setError(
              "Kuota gratis habis. Reset setiap 00:00 WIB."
            );

            break;
          }

          setQueueStatusById((current) => ({
            ...current,
            [item.id]: "done",
          }));

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

          setQueueStatusById((current) => ({
            ...current,
            [item.id]: "error",
          }));

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
        setQueueStatusById((current) => {
          const next = { ...current };

          Object.keys(next).forEach((id) => {
            if (
              next[id] === "waiting" ||
              next[id] === "processing"
            ) {
              next[id] = "cancelled";
            }
          });

          return next;
        });

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
      await loadQuota();
    }
  };

  const activePreviewItem =
    selectedFiles.find((item) => item.id === previewFileId) || null;

  const doneCount = batchResults.filter(
    (item) => item.status === "done"
  ).length;

  const processableCount = Math.min(
    selectedFiles.length,
    quotaRemaining
  );

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
            AUDIO PROCESSING V10.0
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

        {/* DEVICE QUOTA */}
        <section className="device-quota-section">
          <div className="device-quota-card">
            <div className="device-quota-main">
              <div className="device-quota-indicator">
                <span />
              </div>

              <div className="device-quota-copy">
                <strong>DEVICE IDENTIFICATION ACTIVE</strong>

                <span>
                  {deviceLoading
                    ? "Identifying this browser..."
                    : deviceError
                      ? deviceError
                      : "This browser has its own server-side free processing quota."}
                </span>
              </div>
            </div>

            <div className="device-quota-value">
              <small>FREE TODAY</small>

              <strong>
                {quotaLoading ? "..." : `${quotaRemaining}/10`}
              </strong>
            </div>

            <div className="device-quota-reset">
              RESET
              <strong>00:00 WIB</strong>
            </div>
          </div>
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

            {/* SECURITY CHECK */}
            <div className="turnstile-section">
              <div className="turnstile-status">
                <span
                  className={
                    turnstileReady
                      ? "turnstile-dot ready"
                      : "turnstile-dot"
                  }
                />
                <span>SECURITY CHECK</span>
                <small>
                  {turnstileError
                    ? turnstileError
                    : "Cloudflare protection is checked before quota is consumed."}
                </small>
              </div>

              <div
                ref={turnstileContainerRef}
                className="turnstile-container"
              />
            </div>

            {/* PROCESS BUTTON */}
            <button
              type="button"
              className={`process-button ${
                !selectedFiles.length ||
                processing ||
                !deviceReady ||
                
                quotaLoading ||
                quotaRemaining <= 0
                  ? "disabled"
                  : ""
              }`}
              onClick={handleProcess}
              disabled={
                !selectedFiles.length ||
                processing ||
                !deviceReady ||
                
                quotaLoading ||
                quotaRemaining <= 0
              }
            >
              <span>{processing ? "⚙" : "✦"}</span>

              {processing
                ? `PROCESSING ${
                    processingIndex + 1
                  }/${processableCount}`
                : deviceLoading || quotaLoading
                  ? "CHECKING DEVICE QUOTA"
                  : !deviceReady || !deviceFingerprint
                    ? "DEVICE IDENTIFICATION UNAVAILABLE"
                    : quotaRemaining <= 0
                      ? "DAILY LIMIT REACHED"
                      : `PROCESS QUEUE • ${
                          Math.min(
                            selectedFiles.length,
                            quotaRemaining
                          )
                        }`}

              <span>{processing ? "…" : "→"}</span>
            </button>

            {/* PROCESSING RESULTS */}
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
                          disabled={
                            processing ||
                            !deviceReady ||
                            
                            quotaLoading ||
                            quotaRemaining <= 0
                          }
                        >
                          RETRY
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* DOWNLOAD MANAGER */}
            {hasDoneResults && !processing && (
              <div className="download-manager">
                <div className="download-manager-header">
                  <div>
                    <strong>DOWNLOAD MANAGER</strong>

                    <span>
                      {doneCount} FILE
                      {doneCount === 1 ? "" : "S"} READY
                    </span>
                  </div>

                  <button
                    type="button"
                    className="clear-results-button"
                    onClick={clearResults}
                    disabled={processing}
                  >
                    CLEAR RESULTS
                  </button>
                </div>

                <div className="download-manager-toolbar">
                  <button
                    type="button"
                    className="select-results-button"
                    onClick={selectAllDoneResults}
                  >
                    {selectedResultIds.length === doneCount &&
                    doneCount > 0
                      ? "CLEAR SELECTION"
                      : "SELECT ALL"}
                  </button>

                  <button
                    type="button"
                    className="download-selected-button"
                    onClick={downloadSelectedAsZip}
                    disabled={!selectedResultIds.length}
                  >
                    ↓ DOWNLOAD SELECTED ZIP
                  </button>

                  <button
                    type="button"
                    className="download-all-button"
                    onClick={downloadAllAsZip}
                  >
                    ↓ DOWNLOAD ALL ZIP
                  </button>
                </div>

                <div className="download-manager-list">
                  {getDoneResults().map((item) => {
                    const selected =
                      selectedResultIds.includes(item.id);

                    return (
                      <div
                        className={`download-item ${
                          selected ? "selected" : ""
                        }`}
                        key={item.id}
                      >
                        <label className="download-check">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() =>
                              toggleResultSelection(item.id)
                            }
                          />

                          <span />
                        </label>

                        <div className="download-item-info">
                          <strong title={item.outputName}>
                            {item.fileName}
                          </strong>

                          <small>
                            {item.outputName} •{" "}
                            {formatBytes(item.size)}
                          </small>
                        </div>

                        <button
                          type="button"
                          className="download-one-button"
                          onClick={() =>
                            downloadResult(item)
                          }
                        >
                          DOWNLOAD
                        </button>
                      </div>
                    );
                  })}
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
          <span>AUDIO PROCESSOR V10.0</span>
          <span>•</span>
          <span>
            DEVICE FREE {quotaRemaining}/10
          </span>
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
