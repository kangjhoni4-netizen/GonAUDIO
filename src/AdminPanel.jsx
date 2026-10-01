// AdminPanel.jsx — diagnostic revision for Supabase admin-api HTTP errors
// Replace the current AdminPanel.jsx with this complete source after backing it up.
// This improves error visibility; it does not bypass or weaken server authorization.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import "./AdminPanel.css";

const ADMIN_FUNCTION = "admin-api";
const INITIAL_LIMIT = 10;

const PLANS = [
  { key: "3D", label: "3 Hari", price: 30000 },
  { key: "7D", label: "7 Hari", price: 50000 },
  { key: "30D", label: "1 Bulan", price: 80000 },
];

const STATUS_OPTIONS = ["", "UNUSED", "ACTIVE", "EXPIRED", "REVOKED"];

function rupiah(value) {
  return `Rp${Number(value || 0).toLocaleString("id-ID")}`;
}

function formatDate(value) {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "Asia/Jakarta",
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function maskDevice(value) {
  if (!value) return "-";
  if (value.length <= 18) return value;
  return `${value.slice(0, 12)}…`;
}

function getPlanLabel(planKey) {
  return PLANS.find((item) => item.key === planKey)?.label || planKey || "-";
}

function getPlanPrice(planKey) {
  return PLANS.find((item) => item.key === planKey)?.price || 0;
}

function StatusBadge({ status }) {
  return (
    <span className={`rk-access-status ${String(status || "").toLowerCase()}`}>
      {status || "-"}
    </span>
  );
}

function StatMini({ label, value }) {
  return (
    <div className="rk-access-mini-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AdminLogin({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error: loginError } =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (loginError) throw loginError;
      if (!data.session) {
        throw new Error("Session admin tidak berhasil dibuat.");
      }

      onLoggedIn(data.session);
    } catch (loginError) {
      console.error(loginError);
      setError(
        loginError?.message ||
          "Login admin gagal. Periksa email dan password."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rk-admin-login-page">
      <div className="rk-admin-login-glow" />
      <div className="rk-admin-login-card">
        <div className="rk-admin-logo-large">
          <span>RK</span>
          <div>
            <strong>RK ADMIN</strong>
            <small>CONTROL CENTER</small>
          </div>
        </div>

        <div className="rk-admin-login-title">
          <span>RK ADMIN ACCESS</span>
          <h1>Sign in</h1>
          <p>Gunakan akun admin Supabase yang sudah didaftarkan.</p>
        </div>

        <form onSubmit={submit} className="rk-admin-login-form">
          <label>
            <span>EMAIL</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              autoComplete="username"
              disabled={loading}
              required
            />
          </label>

          <label>
            <span>PASSWORD</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              disabled={loading}
              required
            />
          </label>

          {error ? <div className="rk-admin-feedback error">{error}</div> : null}

          <button type="submit" disabled={loading}>
            {loading ? "CHECKING..." : "LOGIN ADMIN"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminDashboard({ session, onLogout }) {
  const [dailyLimit, setDailyLimit] = useState(INITIAL_LIMIT);
  const [inputLimit, setInputLimit] = useState(String(INITIAL_LIMIT));

  const [usage, setUsage] = useState([]);
  const [accessCodes, setAccessCodes] = useState([]);
  const [today, setToday] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const [plan, setPlan] = useState("3D");
  const [quantity, setQuantity] = useState("1");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const [createdCodes, setCreatedCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const filteredCodes = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return accessCodes.filter((row) => {
      const statusOk = !statusFilter || row.status === statusFilter;

      if (!statusOk) return false;
      if (!needle) return true;

      return [
        row.code,
        row.plan_key,
        row.device_key,
        row.status,
      ].some((value) =>
        String(value || "").toLowerCase().includes(needle)
      );
    });
  }, [accessCodes, search, statusFilter]);

  const planCounts = useMemo(() => {
    const counts = { "3D": 0, "7D": 0, "30D": 0 };

    accessCodes.forEach((row) => {
      if (counts[row.plan_key] !== undefined) {
        counts[row.plan_key] += 1;
      }
    });

    return counts;
  }, [accessCodes]);

  const boundDeviceCount = useMemo(
    () =>
      accessCodes.filter(
        (row) =>
          row.device_key &&
          ["ACTIVE", "EXPIRED"].includes(row.status)
      ).length,
    [accessCodes]
  );

  const callAdmin = async (action, extra = {}) => {
    const result = await supabase.functions.invoke(ADMIN_FUNCTION, {
      body: {
        action,
        ...extra,
      },
    });

    const { data, error: functionError } = result;

    if (functionError) {
      const context = functionError?.context;

      // Supabase FunctionsHttpError usually exposes the HTTP Response as
      // `context`, not as an already-parsed object. Read a clone so the
      // original response remains untouched, and surface the server's
      // actual error message in the admin panel/console.
      if (context && typeof context.clone === "function") {
        try {
          const responseCopy = context.clone();
          const contentType =
            responseCopy.headers?.get("content-type") || "";

          if (contentType.includes("application/json")) {
            const body = await responseCopy.json();

            const serverMessage =
              body?.message ||
              body?.error ||
              body?.details ||
              body?.msg;

            if (serverMessage) {
              throw new Error(
                `Admin API (${responseCopy.status}): ${serverMessage}`
              );
            }

            throw new Error(
              `Admin API (${responseCopy.status}): ${JSON.stringify(body)}`
            );
          }

          const bodyText = (await responseCopy.text()).trim();

          if (bodyText) {
            throw new Error(
              `Admin API (${responseCopy.status}): ${bodyText.slice(0, 1200)}`
            );
          }

          throw new Error(
            `Admin API gagal dengan HTTP ${responseCopy.status}.`
          );
        } catch (responseError) {
          // Preserve a useful error parsed above; otherwise fall back to
          // the SDK error below.
          if (
            responseError instanceof Error &&
            responseError.message.startsWith("Admin API")
          ) {
            throw responseError;
          }
        }
      }

      throw new Error(
        functionError?.message ||
          "Admin API gagal. Periksa log Supabase Edge Function admin-api."
      );
    }

    if (!data) {
      throw new Error("Admin API tidak mengembalikan data.");
    }

    if (!data.success) {
      throw new Error(data.message || "Admin request gagal.");
    }

    return data;
  };

  const loadDashboard = async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");

    try {
      const data = await callAdmin("dashboard");
      const limit = Number(data.settings?.daily_limit);

      setDailyLimit(Number.isFinite(limit) ? limit : INITIAL_LIMIT);
      setInputLimit(String(Number.isFinite(limit) ? limit : INITIAL_LIMIT));
      setUsage(Array.isArray(data.usage) ? data.usage : []);
      setAccessCodes(
        Array.isArray(data.access_codes) ? data.access_codes : []
      );
      setToday(data.today || "");
      setUpdatedAt(data.settings?.updated_at || "");
    } catch (dashboardError) {
      console.error(dashboardError);
      setError(
        dashboardError?.message || "Gagal memuat dashboard admin."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    const intervalId = window.setInterval(() => {
      loadDashboard(true);
    }, 10000);

    return () => {
      window.clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveLimit = async (event) => {
    event.preventDefault();
    const value = Number(inputLimit);

    if (!Number.isInteger(value) || value < 0 || value > 1000) {
      setError("Global daily quota harus bilangan bulat 0-1000.");
      setMessage("");
      return;
    }

    setBusyAction("quota");
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("set_limit", {
        dailyLimit: value,
      });

      const saved = Number(data.settings?.daily_limit) || 0;
      setDailyLimit(saved);
      setInputLimit(String(saved));
      setMessage(`Global daily quota diubah menjadi ${saved}.`);
      await loadDashboard(true);
    } catch (saveError) {
      console.error(saveError);
      setError(saveError?.message || "Gagal menyimpan quota.");
    } finally {
      setBusyAction("");
    }
  };

  const createCode = async (event) => {
    event.preventDefault();
    const amount = Number(quantity);

    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      setError("Jumlah code harus bilangan bulat 1-100.");
      setMessage("");
      return;
    }

    setBusyAction("generate");
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("create_codes", {
        planKey: plan,
        quantity: amount,
      });

      const created = Array.isArray(data.codes) ? data.codes : [];
      setCreatedCodes(created);
      setQuantity("1");
      setMessage(
        `${created.length || amount} access code ${plan} berhasil dibuat.`
      );
      await loadDashboard(true);
    } catch (createError) {
      console.error(createError);
      setError(createError?.message || "Gagal membuat access code.");
    } finally {
      setBusyAction("");
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setMessage(`Code ${code} berhasil disalin.`);
      setError("");
    } catch {
      setError("Browser tidak mengizinkan copy otomatis.");
      setMessage("");
    }
  };

  const resetDevice = async (code) => {
    if (
      !window.confirm(
        `Reset device binding untuk ${code}?\n\nCode akan kembali menjadi UNUSED dan bisa diaktifkan pada device lain.`
      )
    ) {
      return;
    }

    setBusyAction(`reset:${code}`);
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("reset_device", { code });
      setMessage(data.message || "Device binding berhasil direset.");
      await loadDashboard(true);
    } catch (resetError) {
      console.error(resetError);
      setError(resetError?.message || "Gagal mereset device.");
    } finally {
      setBusyAction("");
    }
  };

  const revokeCode = async (code) => {
    if (!window.confirm(`Cabut access code ${code}?`)) return;

    setBusyAction(`revoke:${code}`);
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("revoke_code", { code });
      setMessage(data.message || "Access code berhasil dicabut.");
      await loadDashboard(true);
    } catch (revokeError) {
      console.error(revokeError);
      setError(revokeError?.message || "Gagal mencabut access code.");
    } finally {
      setBusyAction("");
    }
  };

  const deleteCode = async (code) => {
    if (
      !window.confirm(
        `Hapus permanen access code ${code}?\n\nData code akan dihapus dari database.`
      )
    ) {
      return;
    }

    setBusyAction(`delete:${code}`);
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("delete_code", { code });
      setMessage(data.message || "Access code berhasil dihapus.");
      setCreatedCodes((items) => items.filter((item) => item.code !== code));
      await loadDashboard(true);
    } catch (deleteError) {
      console.error(deleteError);
      setError(deleteError?.message || "Gagal menghapus access code.");
    } finally {
      setBusyAction("");
    }
  };

  const resetToday = async () => {
    if (
      !window.confirm(
        `Reset quota semua device untuk ${today || "hari ini"}?`
      )
    ) {
      return;
    }

    setBusyAction("reset-today");
    setError("");
    setMessage("");

    try {
      const data = await callAdmin("reset_today");
      setMessage(data.message || "Quota hari ini berhasil direset.");
      await loadDashboard(true);
    } catch (resetError) {
      console.error(resetError);
      setError(resetError?.message || "Gagal mereset quota hari ini.");
    } finally {
      setBusyAction("");
    }
  };

  if (loading) {
    return (
      <div className="rk-admin-loading">
        <div className="rk-admin-loading-mark">RK</div>
        <span>LOADING ACCESS MANAGEMENT...</span>
      </div>
    );
  }

  return (
    <div className="rk-admin-app">
      <aside className="rk-admin-sidebar">
        <div className="rk-admin-brand">
          <div className="rk-admin-brand-mark">RK</div>
          <div>
            <strong>RK ADMIN</strong>
            <span>CONTROL CENTER</span>
          </div>
        </div>

        <div className="rk-admin-menu-label">MENU</div>

        <nav className="rk-admin-nav">
          <a href="#admin" className="rk-admin-nav-item">
            <span>⌂</span>
            Dashboard
          </a>
          <button type="button" className="rk-admin-nav-item">
            <span>◉</span>
            Analytics
          </button>
          <button type="button" className="rk-admin-nav-item">
            <span>◈</span>
            Accounts
          </button>
          <button
            type="button"
            className="rk-admin-nav-item active"
            aria-current="page"
          >
            <span>⌁</span>
            Access Management
          </button>
          <button type="button" className="rk-admin-nav-item">
            <span>⚙</span>
            Maintenance
          </button>
          <button type="button" className="rk-admin-nav-item">
            <span>◇</span>
            Security
          </button>
          <button type="button" className="rk-admin-nav-item">
            <span>▤</span>
            Activity Logs
          </button>
          <button type="button" className="rk-admin-nav-item">
            <span>✦</span>
            Settings
          </button>
        </nav>

        <div className="rk-admin-sidebar-bottom">
          <div className="rk-admin-session">
            <span className="rk-online-dot" />
            <div>
              <strong>ADMIN SESSION</strong>
              <small>{session?.user?.email || "Admin"}</small>
            </div>
          </div>
          <button type="button" className="rk-admin-sidebar-logout" onClick={onLogout}>
            LOGOUT
          </button>
        </div>
      </aside>

      <main className="rk-admin-main">
        <header className="rk-admin-topbar">
          <div className="rk-admin-title-wrap">
            <div className="rk-admin-mobile-menu">☰</div>
            <div>
              <span>RK ADMIN ACCESS</span>
              <h1>Access Management</h1>
            </div>
          </div>

          <div className="rk-admin-top-actions">
            <div className="rk-admin-server-status">
              <span className="rk-online-dot" />
              SERVER ONLINE
            </div>
            <a href="#" className="rk-admin-public-link">PUBLIC SITE</a>
            <button type="button" onClick={onLogout}>LOGOUT</button>
          </div>
        </header>

        <div className="rk-admin-content">
          {error ? <div className="rk-admin-feedback error">{error}</div> : null}
          {message ? <div className="rk-admin-feedback success">{message}</div> : null}

          <section className="rk-generate-card">
            <div>
              <span className="rk-section-eyebrow">Generate New Code</span>
              <p>Buat kode akses baru untuk pengguna RK Bypass.</p>
            </div>

            <form className="rk-generate-form" onSubmit={createCode}>
              <label>
                <span>DURASI AKSES</span>
                <select
                  value={plan}
                  onChange={(event) => setPlan(event.target.value)}
                  disabled={busyAction === "generate"}
                >
                  {PLANS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>JUMLAH CODE</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={busyAction === "generate"}
                />
              </label>

              <button type="submit" disabled={busyAction === "generate"}>
                {busyAction === "generate" ? "GENERATING..." : "GENERATE ACCESS CODE"}
              </button>
            </form>
          </section>

          {createdCodes.length > 0 ? (
            <section className="rk-created-box">
              <div>
                <span>NEW CODE GENERATED</span>
                <small>Copy dan kirim code ini ke customer.</small>
              </div>
              <div className="rk-created-list">
                {createdCodes.map((row) => (
                  <button
                    type="button"
                    className="rk-created-code"
                    key={row.id || row.code}
                    onClick={() => copyCode(row.code)}
                  >
                    <code>{row.code}</code>
                    <span>COPY</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rk-access-summary">
            <StatMini label="3 Hari" value={planCounts["3D"]} />
            <StatMini label="7 Hari" value={planCounts["7D"]} />
            <StatMini label="1 Bulan" value={planCounts["30D"]} />
            <StatMini label="Terikat Device" value={boundDeviceCount} />
          </section>

          <section className="rk-access-card">
            <div className="rk-access-card-head">
              <div>
                <span className="rk-section-eyebrow">Access Codes</span>
                <p>Semua code yang tersimpan pada RK Access Server.</p>
              </div>
              <button
                type="button"
                className="rk-refresh-button"
                onClick={() => loadDashboard(true)}
                disabled={busyAction !== ""}
              >
                ↻ Refresh
              </button>
            </div>

            <div className="rk-access-toolbar">
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cari code, device ID, status..."
              />

              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="">ALL STATUS</option>
                {STATUS_OPTIONS.filter(Boolean).map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="rk-access-table-wrap">
              <table className="rk-access-table">
                <thead>
                  <tr>
                    <th>ACCESS CODE</th>
                    <th>DURASI</th>
                    <th>STATUS</th>
                    <th>DEVICE</th>
                    <th>CREATED</th>
                    <th>EXPIRES</th>
                    <th>ACTION</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredCodes.length ? (
                    filteredCodes.map((row) => {
                      const rowBusy =
                        busyAction.endsWith(`:${row.code}`) ||
                        busyAction === `reset:${row.code}` ||
                        busyAction === `revoke:${row.code}` ||
                        busyAction === `delete:${row.code}`;

                      return (
                        <tr key={row.id || row.code}>
                          <td>
                            <code className="rk-code-value">{row.code}</code>
                          </td>
                          <td>{getPlanLabel(row.plan_key)}</td>
                          <td>
                            <StatusBadge status={row.status} />
                          </td>
                          <td>
                            <span
                              className="rk-device-value"
                              title={row.device_key || ""}
                            >
                              {maskDevice(row.device_key)}
                            </span>
                          </td>
                          <td>{formatDate(row.created_at)}</td>
                          <td>{formatDate(row.expires_at)}</td>
                          <td>
                            <div className="rk-row-actions">
                              <button
                                type="button"
                                onClick={() => copyCode(row.code)}
                                disabled={rowBusy}
                              >
                                COPY
                              </button>

                              {row.status === "ACTIVE" ? (
                                <button
                                  type="button"
                                  onClick={() => resetDevice(row.code)}
                                  disabled={rowBusy}
                                >
                                  {busyAction === `reset:${row.code}` ? "..." : "RESET"}
                                </button>
                              ) : null}

                              {row.status === "UNUSED" || row.status === "ACTIVE" ? (
                                <button
                                  type="button"
                                  className="danger-soft"
                                  onClick={() => revokeCode(row.code)}
                                  disabled={rowBusy}
                                >
                                  {busyAction === `revoke:${row.code}` ? "..." : "REVOKE"}
                                </button>
                              ) : null}

                              <button
                                type="button"
                                className="danger"
                                onClick={() => deleteCode(row.code)}
                                disabled={rowBusy}
                              >
                                {busyAction === `delete:${row.code}` ? "..." : "DELETE"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="7" className="rk-empty-cell">
                        Belum ada access code yang cocok dengan filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rk-access-table-footer">
              <span>
                Menampilkan <strong>{filteredCodes.length}</strong> dari{" "}
                <strong>{accessCodes.length}</strong> access code
              </span>
              <span>{today || "-"} WIB</span>
            </div>
          </section>

          <section className="rk-quota-strip">
            <div>
              <span>GLOBAL DAILY QUOTA</span>
              <strong>{dailyLimit} process / device / day</strong>
              <small>Last update: {formatDate(updatedAt)}</small>
            </div>

            <form onSubmit={saveLimit}>
              <input
                type="number"
                min="0"
                max="1000"
                step="1"
                value={inputLimit}
                onChange={(event) => setInputLimit(event.target.value)}
                disabled={busyAction === "quota"}
              />
              <button type="submit" disabled={busyAction === "quota"}>
                {busyAction === "quota" ? "..." : "SAVE QUOTA"}
              </button>
            </form>

            <button
              type="button"
              className="rk-quota-reset"
              onClick={resetToday}
              disabled={busyAction === "reset-today"}
            >
              {busyAction === "reset-today" ? "RESETTING..." : "RESET TODAY"}
            </button>
          </section>

          <footer className="rk-admin-footer">
            <span>RK ADMIN</span>
            <span>•</span>
            <span>ACCESS MANAGEMENT</span>
            <span>•</span>
            <span>SERVER CONTROL</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default function AdminPanel() {
  const [session, setSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession || null);
      setCheckingSession(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.hash = "admin";
  };

  if (checkingSession) {
    return (
      <div className="rk-admin-loading">
        <div className="rk-admin-loading-mark">RK</div>
        <span>CHECKING ADMIN SESSION...</span>
      </div>
    );
  }

  if (!session) {
    return <AdminLogin onLoggedIn={setSession} />;
  }

  return <AdminDashboard session={session} onLogout={handleLogout} />;
}
