// Admin Dashboard Controller
document.addEventListener("DOMContentLoaded", () => {
  const clientNameInput = document.getElementById("clientName");
  const presetBtns = document.querySelectorAll(".preset-btn:not(.custom-toggle)");
  const customMinsBtn = document.getElementById("customMinsBtn");
  const customMinsInput = document.getElementById("customMinsInput");
  const btnGenerate = document.getElementById("btnGenerate");
  const linkResultBox = document.getElementById("linkResultBox");
  const generatedLinkInput = document.getElementById("generatedLinkInput");
  const resultDurationBadge = document.getElementById("resultDurationBadge");
  const btnCopyLink = document.getElementById("btnCopyLink");
  const btnOpenLink = document.getElementById("btnOpenLink");
  const btnRefresh = document.getElementById("btnRefresh");
  const sessionsTableBody = document.getElementById("sessionsTableBody");
  const adminPresetSelect = document.getElementById("adminPresetSelect");

  let selectedMins = 35;

  // Load Presets into Admin Dropdown
  async function loadAdminPresets() {
    if (!adminPresetSelect) return;
    try {
      const res = await fetch("/api/presets");
      const data = await res.json();
      if (data.presets && data.presets.length > 0) {
        data.presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `Pre-load: ${p.name}`;
          adminPresetSelect.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn("Could not load presets in admin:", e);
    }
  }
  loadAdminPresets();

  // Preset button selection
  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      presetBtns.forEach(b => b.classList.remove("active"));
      customMinsBtn.classList.remove("active");
      customMinsInput.classList.add("hidden");
      btn.classList.add("active");
      selectedMins = parseInt(btn.dataset.mins);
    });
  });

  // Custom minutes toggle
  customMinsBtn.addEventListener("click", () => {
    presetBtns.forEach(b => b.classList.remove("active"));
    customMinsBtn.classList.add("active");
    customMinsInput.classList.remove("hidden");
    customMinsInput.focus();
    selectedMins = parseInt(customMinsInput.value) || 45;
  });

  customMinsInput.addEventListener("input", () => {
    selectedMins = parseInt(customMinsInput.value) || 35;
  });

  // Generate link action
  btnGenerate.addEventListener("click", async () => {
    btnGenerate.disabled = true;
    btnGenerate.innerHTML = "⏳ Generating...";

    try {
      const presetId = adminPresetSelect ? adminPresetSelect.value : "";
      const res = await fetch("/api/admin/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: clientNameInput.value.trim() || "Client",
          duration_minutes: selectedMins,
          preset_id: presetId || null
        })
      });

      const data = await res.json();
      if (data.success) {
        generatedLinkInput.value = data.link;
        resultDurationBadge.textContent = `⏱️ ${selectedMins} Min Session`;
        btnOpenLink.href = data.link;
        linkResultBox.classList.remove("hidden");
        loadSessions();
      }
    } catch (err) {
      alert("Error generating session: " + err.message);
    } finally {
      btnGenerate.disabled = false;
      btnGenerate.innerHTML = `<span class="btn-icon">⚡</span> Generate Client Link`;
    }
  });

  // Copy link
  btnCopyLink.addEventListener("click", () => {
    generatedLinkInput.select();
    navigator.clipboard.writeText(generatedLinkInput.value);
    btnCopyLink.innerHTML = "<span>✅ Copied!</span>";
    setTimeout(() => {
      btnCopyLink.innerHTML = "<span>📋 Copy Link</span>";
    }, 2000);
  });

  // Refresh sessions table
  async function loadSessions() {
    try {
      const res = await fetch("/api/admin/sessions");
      const data = await res.json();
      if (!data.success) return;

      if (data.sessions.length === 0) {
        sessionsTableBody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center py-4" style="color: var(--text-muted); text-align: center; padding: 20px;">
              No active sessions. Click "Generate Client Link" above to start.
            </td>
          </tr>
        `;
        return;
      }

      sessionsTableBody.innerHTML = data.sessions.map(s => {
        const remainingMin = Math.floor(s.remaining_seconds / 60);
        const remainingSec = s.remaining_seconds % 60;
        const timeStr = `${String(remainingMin).padStart(2, '0')}:${String(remainingSec).padStart(2, '0')}`;
        
        const statusBadge = s.is_active
          ? (s.client_connected 
              ? `<span class="badge badge-success">🟢 Streaming</span>` 
              : `<span class="badge" style="background: rgba(59,130,246,0.2); color: #60a5fa;">🟡 Ready (Link Shared)</span>`)
          : `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171;">🔴 Expired</span>`;

        const faceBadge = s.has_face 
          ? `<span style="color: #34d399;">✅ Face Locked</span>` 
          : `<span style="color: #94a3b8;">⏳ Waiting for photo</span>`;

        return `
          <tr>
            <td>
              <strong>${s.client_name}</strong>
              <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #64748b;">${s.token}</div>
            </td>
            <td>${statusBadge}</td>
            <td style="font-family: var(--font-mono); font-weight: 600; color: #38bdf8;">
              ${s.is_active ? `⏱️ ${timeStr}` : '00:00'}
            </td>
            <td>${faceBadge}</td>
            <td style="font-family: var(--font-mono); color: #10b981; font-weight: 600;">
              ${s.client_connected ? `${s.fps} FPS` : '--'}
            </td>
            <td>
              ${s.is_active ? `
                <button class="btn btn-sm btn-outline btn-terminate" data-token="${s.token}" style="color: #f87171; border-color: rgba(239,68,68,0.3);">
                  ⏹️ Terminate
                </button>
              ` : `<span style="color: #64748b; font-size: 0.8rem;">Finished</span>`}
            </td>
          </tr>
        `;
      }).join("");

      // Attach terminate listeners
      document.querySelectorAll(".btn-terminate").forEach(b => {
        b.addEventListener("click", async () => {
          if (confirm("Are you sure you want to immediately terminate this client session?")) {
            await fetch("/api/admin/terminate-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: b.dataset.token })
            });
            loadSessions();
          }
        });
      });

    } catch (err) {
      console.error("Error loading sessions:", err);
    }
  }

  btnRefresh.addEventListener("click", loadSessions);
  loadSessions();
  setInterval(loadSessions, 3000);
});
