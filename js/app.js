(function () {
  "use strict";

  const db = window.supabaseClient;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    page: "dashboard",
    settings: { store_name: "UD Fikri", active_date: localDate() },
    employees: [], imports: [], products: [], salaries: [], withdrawals: [],
    expenses: [], rules: [], reports: [], profile: null, profiles: [], categories: [], audits: [],
    cash: [], allocationWithdrawals: [], reportMonth: localDate().slice(0, 7), parsedImport: null
  };

  const titles = {
    dashboard: "Dashboard", sales: "Import & Tutup Buku", salary: "Gaji Karyawan",
    expenses: "Pengeluaran", reports: "Laporan & Kas", master: "Kelola Data"
  };

  function localDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function num(value) { return Number(value) || 0; }
  function sum(rows, key) { return rows.reduce((total, row) => total + num(row[key]), 0); }
  function rupiah(value) { return `Rp ${Math.round(num(value)).toLocaleString("id-ID")}`; }
  function formatDate(value) {
    if (!value) return "-";
    return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("id-ID", {
      day: "2-digit", month: "short", year: "numeric"
    });
  }
  function formatTimestamp(value) { return value ? new Date(value).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-"; }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }
  function byNewest(a, b) {
    const dateA = a.salary_date || a.withdrawal_date || a.expense_date || a.report_date || "";
    const dateB = b.salary_date || b.withdrawal_date || b.expense_date || b.report_date || "";
    return String(dateB).localeCompare(String(dateA));
  }
  function toast(message, type = "success") {
    const element = $("#toast");
    element.textContent = message;
    element.className = `toast show ${type === "error" ? "error" : ""}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 3200);
  }
  function setLoading(active) { $("#loading").classList.toggle("hidden", !active); }
  function openFormModal(title, fields, submitLabel = "Simpan") {
    return new Promise(resolve => {
      const modal = $("#formModal");
      $("#modalTitle").textContent = title;
      $("#modalSubmit").textContent = submitLabel;
      $("#modalFields").innerHTML = fields.map(field => {
        const common = `name="${field.name}" ${field.required ? "required" : ""}`;
        const value = escapeHtml(field.value ?? "");
        const control = field.type === "select"
          ? `<select ${common}>${field.options.map(option => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value ?? "") ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>`
          : field.type === "textarea" ? `<textarea ${common} placeholder="${escapeHtml(field.placeholder || "")}">${value}</textarea>`
          : `<input ${common} type="${field.type || "text"}" value="${value}" min="${field.min ?? ""}" step="${field.step ?? ""}" placeholder="${escapeHtml(field.placeholder || "")}">`;
        return `<div class="field ${field.full ? "full" : ""}"><label>${escapeHtml(field.label)}</label>${control}</div>`;
      }).join("");
      document.body.classList.add("modal-open");
      modal.classList.remove("hidden");
      setTimeout(() => $("input,select,textarea", modal)?.focus(), 0);
      modal._resolve = resolve;
    });
  }
  function closeFormModal(result = null) {
    const modal = $("#formModal");
    modal.classList.add("hidden");
    document.body.classList.remove("modal-open");
    const resolve = modal._resolve;
    modal._resolve = null;
    if (resolve) resolve(result);
  }
  function assertResult(result) { if (result.error) throw result.error; return result.data; }
  function currentDate() { return state.settings.active_date || localDate(); }
  function currentImport() { return state.imports.find(row => row.report_date === currentDate()) || null; }
  function currentReport() { return state.reports.find(row => row.report_date === currentDate()) || null; }
  function isLockedDate(date) { const report = state.reports.find(row => row.report_date === date); return Boolean(report && report.book_status !== "reopened"); }
  function isDateLocked() { return isLockedDate(currentDate()); }
  function ensureDateUnlocked(date) { if (isLockedDate(date)) throw new Error(`Tutup buku ${formatDate(date)} sudah dikunci. Buka kembali sebelum mengubah data.`); }
  function ensureUnlocked() { ensureDateUnlocked(currentDate()); }
  function currentSalaries() { return state.salaries.filter(row => row.salary_date === currentDate()); }
  function currentExpenses() { return state.expenses.filter(row => row.expense_date === currentDate()); }
  function activeEmployees() { return state.employees.filter(row => row.active); }
  function activeRules() { return state.rules.filter(row => row.active).sort((a, b) => num(a.sort_order) - num(b.sort_order)); }
  function role() { return state.profile?.role || "viewer"; }
  function canWrite() { return ["superadmin", "admin", "staff"].includes(role()) && state.profile?.active !== false; }
  function canDelete() { return ["superadmin", "admin"].includes(role()) && state.profile?.active !== false; }
  function canManageMaster() { return ["superadmin", "admin"].includes(role()); }
  function canManageUsers() { return role() === "superadmin"; }

  function salaryLedger() {
    return state.employees.map(employee => {
      const earned = state.salaries.filter(row => row.employee_id === employee.id).reduce((total, row) => total + num(row.total), 0);
      const withdrawn = state.withdrawals.filter(row => row.employee_id === employee.id).reduce((total, row) => total + num(row.amount), 0);
      return { employee_id: employee.id, employee_name: employee.name, earned, withdrawn, balance: earned - withdrawn };
    });
  }

  function calculation() {
    const imported = currentImport();
    const salaries = currentSalaries();
    const expenses = currentExpenses();
    const rules = activeRules();
    const grossProfit = num(imported?.gross_profit);
    const salary = sum(salaries, "total");
    const expense = sum(expenses, "amount");
    const fixed = rules.filter(row => row.rule_type === "fixed").reduce((total, row) => total + num(row.value), 0);
    const balanceBeforeShare = grossProfit - salary - expense - fixed;
    const deficit = Math.max(0, -balanceBeforeShare);
    const profitToShare = Math.max(0, balanceBeforeShare);
    const allocations = [
      ...salaries.map(row => ({ name: `Gaji ${row.employee_name}`, type: "salary", amount: num(row.total), value: num(row.total) })),
      ...expenses.map(row => ({ name: `${row.category}${row.employee_name ? ` — ${row.employee_name}` : ""}`, type: "expense", amount: num(row.amount), value: num(row.amount) })),
      ...rules.filter(row => row.rule_type === "fixed").map(row => ({ name: row.name, type: "fixed", target: row.allocation_target || "other", amount: num(row.value), value: num(row.value) })),
      ...rules.filter(row => row.rule_type === "percent").map(row => ({ name: row.name, type: "percent", target: row.allocation_target || "other", amount: profitToShare * num(row.value) / 100, value: num(row.value) }))
    ];
    const percentageAllocations = allocations.filter(row => row.type === "percent").reduce((total, row) => total + row.amount, 0);
    const ownerResult = allocations.filter(row => row.target === "owner" || (!row.target && /pemilik/i.test(row.name))).reduce((total, row) => total + row.amount, 0);
    return {
      productSales: num(imported?.product_sales), capital: num(imported?.capital), grossProfit,
      transactions: num(imported?.transactions), items: num(imported?.items), shipping: num(imported?.shipping),
      salary, expenses: expense, employeeExpenses: expenses.filter(row => row.expense_type === "employee").reduce((total, row) => total + num(row.amount), 0),
      fixedAllocations: fixed, profitToShare, deficit, percentageAllocations, ownerResult,
      unallocated: grossProfit - salary - expense - fixed - percentageAllocations, allocations
    };
  }

  async function initialize() {
    if (!window.supabaseConfigured) {
      $("#loginMessage").innerHTML = "Supabase belum dikonfigurasi. Isi <strong>js/config.js</strong> terlebih dahulu.";
      $("#loginForm button").disabled = true;
      return;
    }
    const { data: { session } } = await db.auth.getSession();
    showSession(Boolean(session));
    if (session) await loadData();
    db.auth.onAuthStateChange((_event, nextSession) => showSession(Boolean(nextSession)));
  }

  function showSession(authenticated) {
    $("#loginScreen").classList.toggle("hidden", authenticated);
    $("#appShell").classList.toggle("hidden", !authenticated);
  }

  async function loadData() {
    setLoading(true);
    try {
      const { data: { user } } = await db.auth.getUser();
      const queries = await Promise.all([
        db.from("settings").select("*").eq("id", 1).maybeSingle(),
        db.from("employees").select("*").order("name"),
        db.from("sales_imports").select("*").order("report_date", { ascending: false }),
        db.from("import_products").select("*").order("product"),
        db.from("salaries").select("*").order("salary_date", { ascending: false }),
        db.from("salary_withdrawals").select("*").order("withdrawal_date", { ascending: false }),
        db.from("expenses").select("*").order("expense_date", { ascending: false }),
        db.from("allocation_rules").select("*").order("sort_order"),
        db.from("daily_reports").select("*").order("report_date", { ascending: false }),
        db.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        db.from("profiles").select("*").order("full_name"),
        db.from("expense_categories").select("*").order("name"),
        db.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100),
        db.from("cash_reconciliations").select("*").order("report_date", { ascending: false }),
        db.from("allocation_withdrawals").select("*").order("withdrawal_date", { ascending: false })
      ]);
      queries.forEach(assertResult);
      state.settings = queries[0].data || state.settings;
      [state.employees, state.imports, state.products, state.salaries, state.withdrawals, state.expenses, state.rules, state.reports] = queries.slice(1, 9).map(result => result.data || []);
      state.profile = queries[9].data;
      state.profiles = queries[10].data || [];
      state.categories = queries[11].data || [];
      state.audits = queries[12].data || [];
      state.cash = queries[13].data || [];
      state.allocationWithdrawals = queries[14].data || [];
      if (!state.profile?.active) throw new Error("Akun Anda belum aktif atau telah dinonaktifkan.");
      $("#brandName").textContent = state.settings.store_name;
      $("#userRole").textContent = role().toUpperCase();
      $("#activeDate").value = currentDate();
      renderPage();
    } catch (error) {
      toast(error.message || "Data gagal dimuat.", "error");
    } finally { setLoading(false); }
  }

  function changePage(page) {
    state.page = page;
    $("#pageTitle").textContent = titles[page];
    $$(".nav-item[data-page]").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    $("#sidebar").classList.remove("open");
    renderPage();
    $("#mainContent").focus();
  }

  function renderPage() {
    const renderers = { dashboard: renderDashboard, sales: renderSales, salary: renderSalary, expenses: renderExpenses, reports: renderReports, master: renderMaster };
    $("#mainContent").innerHTML = renderers[state.page]();
    bindPageEvents();
    applyPermissions();
  }

  function applyPermissions() {
    if (!canWrite()) $$("#mainContent form input, #mainContent form select, #mainContent form textarea, #mainContent form button, #mainContent [data-action]:not([data-action='export-excel']):not([data-action='print-report'])").forEach(element => element.disabled = true);
    if (!canDelete()) $$('[data-action^="delete-"]').forEach(element => element.remove());
    if (!canManageMaster()) $$('[data-action$="category"]').forEach(element => element.remove());
    if (!canManageUsers()) $$('[data-action="edit-profile"]').forEach(element => element.remove());
    if (!canManageMaster()) $$('[data-action="backup-data"]').forEach(element => element.remove());
  }

  function metric(label, value, tone = "") {
    return `<article class="card metric"><div class="metric-label">${label}</div><div class="metric-value ${tone}">${value}</div></article>`;
  }

  function renderDashboard() {
    const summary = calculation();
    const salaryDetails = currentSalaries().length
      ? currentSalaries().map(row => `<div class="split-row"><span>${escapeHtml(row.employee_name)}${num(row.bonus) > 0 ? ` <small>+ bonus ${rupiah(row.bonus)}</small>` : ""}</span><strong>${rupiah(row.total)}</strong></div>`).join("")
      : '<div class="empty">Belum ada gaji pada tanggal ini.</div>';
    const expenseDetails = currentExpenses().length
      ? currentExpenses().map(row => `<div class="split-row"><span>${escapeHtml(row.category)}${row.employee_name ? ` <small>— ${escapeHtml(row.employee_name)}</small>` : ""}</span><strong>${rupiah(row.amount)}</strong></div>`).join("")
      : '<div class="empty">Belum ada pengeluaran pada tanggal ini.</div>';
    const allocationDetails = summary.allocations.filter(row => ["fixed", "percent"].includes(row.type)).length
      ? summary.allocations.filter(row => ["fixed", "percent"].includes(row.type)).map(row => `<div class="split-row"><span>${escapeHtml(row.name)}${row.type === "percent" ? ` <small>(${num(row.value)}%)</small>` : ""}</span><strong class="${row.target === "owner" ? "positive" : ""}">${rupiah(row.amount)}</strong></div>`).join("")
      : '<div class="empty">Belum ada aturan alokasi aktif.</div>';
    const history = state.reports.length
      ? state.reports.map(row => `<tr><td>${formatDate(row.report_date)}</td><td>${rupiah(row.product_sales)}</td><td>${rupiah(row.capital)}</td><td>${rupiah(row.gross_profit)}</td><td>${rupiah(row.salary)}</td><td>${rupiah(row.expenses)}</td><td>${rupiah(row.profit_to_share)}</td><td><strong>${rupiah(row.owner_result)}</strong></td><td><button class="button danger small" data-action="delete-report" data-id="${row.id}">Hapus</button></td></tr>`).join("")
      : '<tr><td colspan="9" class="empty">Belum ada riwayat tutup buku.</td></tr>';
    return `
      <div class="page-head"><div><h3>Ringkasan ${formatDate(currentDate())}</h3><p>Posisi penjualan dan pembagian laba tanggal aktif.</p></div><button class="button primary" data-go="sales">Import penjualan</button></div>
      <section class="grid metric-grid">
        ${metric("Penjualan produk", rupiah(summary.productSales))}${metric("Modal barang", rupiah(summary.capital))}
        ${metric("Laba kotor", rupiah(summary.grossProfit), "positive")}${metric("Gaji & bonus", rupiah(summary.salary), "negative")}
        ${metric("Semua pengeluaran", rupiah(summary.expenses), "negative")}${metric("Sisa laba untuk alokasi", rupiah(summary.profitToShare), "positive")}
        ${metric("Hasil pemilik", rupiah(summary.ownerResult), "positive")}${metric("Item terjual", summary.items.toLocaleString("id-ID"))}${summary.deficit > 0 ? metric("Defisit hari ini", `− ${rupiah(summary.deficit)}`, "negative") : ""}
      </section>
      <section class="grid three section-gap detail-card-grid">
        <article class="card detail-card"><h4>Rincian Gaji & Bonus</h4>${salaryDetails}<div class="detail-total"><span>Total gaji & bonus</span><strong>${rupiah(summary.salary)}</strong></div></article>
        <article class="card detail-card"><h4>Rincian Pengeluaran</h4>${expenseDetails}<div class="detail-total"><span>Total pengeluaran</span><strong>${rupiah(summary.expenses)}</strong></div></article>
        <article class="card detail-card"><h4>Rincian Alokasi</h4>${allocationDetails}<div class="detail-total"><span>Total alokasi</span><strong>${rupiah(summary.fixedAllocations + summary.percentageAllocations)}</strong></div></article>
      </section>
      <section class="section-gap">
        <article class="card"><h4>Alur perhitungan</h4>
          <div class="split-row"><span>Laba kotor</span><strong>${rupiah(summary.grossProfit)}</strong></div>
          <div class="split-row"><span>Gaji dan bonus</span><strong class="negative">− ${rupiah(summary.salary)}</strong></div>
          <div class="split-row"><span>Semua pengeluaran</span><strong class="negative">− ${rupiah(summary.expenses)}</strong></div>
          <div class="split-row"><span>Alokasi nominal tetap</span><strong class="negative">− ${rupiah(summary.fixedAllocations)}</strong></div>
          <div class="split-row"><span>Sisa laba untuk alokasi</span><strong class="positive">${rupiah(summary.profitToShare)}</strong></div>
        </article>
      </section>
      <section class="card section-gap"><h4>Riwayat tutup buku</h4><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Penjualan</th><th>Modal</th><th>Laba</th><th>Gaji</th><th>Pengeluaran</th><th>Dasar alokasi</th><th>Pemilik</th><th>Aksi</th></tr></thead><tbody>${history}</tbody></table></div></section>`;
  }

  function renderSales() {
    const imported = currentImport();
    const report = currentReport();
    const locked = isDateLocked();
    const products = state.products.filter(row => row.report_date === currentDate());
    const summary = calculation();
    const productRows = products.length
      ? products.map(row => `<tr data-product-row="${row.id}" data-sales="${num(row.sales)}"><td>${escapeHtml(row.product)}</td><td>${rupiah(row.sales)}</td><td><input class="item-input" data-id="${row.id}" type="number" step="0.01" min="0" value="${num(row.items)}"></td><td><input class="unit-capital-input" data-id="${row.id}" type="number" step="0.0001" min="0" value="${num(row.unit_capital)}"></td><td><span class="live-profit">${rupiah(row.profit)}</span></td><td class="capital-cell"><strong class="live-capital">${rupiah(row.capital)}</strong></td><td><div class="button-row"><button class="button edit small" data-action="edit-product" data-id="${row.id}">Edit</button><button class="button secondary small" data-action="save-item" data-id="${row.id}">Simpan hitungan</button><button class="button danger small" data-action="delete-product" data-id="${row.id}">Hapus</button></div></td></tr>`).join("")
      : '<tr><td colspan="7" class="empty">Belum ada produk pada tanggal ini.</td></tr>';
    const salaryDeductions = currentSalaries().length ? currentSalaries().map(row => `<tr><td>Gaji</td><td>${escapeHtml(row.employee_name)}</td><td>${rupiah(row.base_salary)}</td><td>${rupiah(row.bonus)}</td><td><strong>${rupiah(row.total)}</strong></td><td><div class="button-row"><button class="button edit small" data-action="edit-salary" data-id="${row.id}">Edit</button><button class="button danger small" data-action="delete-salary" data-id="${row.id}">Hapus</button></div></td></tr>`).join("") : '<tr><td colspan="6" class="empty">Belum ada gaji tanggal ini.</td></tr>';
    const expenseDeductions = currentExpenses().length ? currentExpenses().map(row => `<tr><td>${row.expense_type === "employee" ? "Karyawan" : "Operasional"}</td><td>${escapeHtml(row.employee_name || "-")}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.description || "-")}</td><td><strong>${rupiah(row.amount)}</strong></td><td><div class="button-row"><button class="button edit small" data-action="edit-expense" data-id="${row.id}">Edit</button><button class="button danger small" data-action="delete-expense" data-id="${row.id}">Hapus</button></div></td></tr>`).join("") : '<tr><td colspan="6" class="empty">Belum ada pengeluaran tanggal ini.</td></tr>';
    return `
      <div class="page-head"><div><h3>Import laporan Griyo Pos</h3><p>Pilih file Produk Terlaris untuk menghitung penjualan, laba, dan modal.</p></div></div>
      <div class="book-status ${locked ? "locked" : "open"}"><span><strong>${locked ? "Tutup buku dikunci" : report ? "Tutup buku dibuka kembali" : "Belum ditutup"}</strong><small>${locked ? "Data penjualan, gaji, dan pengeluaran tidak dapat diubah." : "Data tanggal ini masih dapat ditambah atau diperbarui."}</small></span>${locked ? '<button class="button danger" data-action="reopen-book">Buka kembali</button>' : ""}</div>
      <section class="grid two">
        <form id="importForm" class="card"><h4>File penjualan</h4>
          <div class="field"><label>File Excel</label><input id="griyoFile" type="file" accept=".xlsx,.xls" required ${locked ? "disabled" : ""}></div>
          <div id="importInfo" class="notice info">Tanggal laporan mengikuti tanggal aktif: ${formatDate(currentDate())}.</div>
          <button id="importButton" class="button primary" type="submit" disabled>Import dan hitung</button>
        </form>
        <article class="card"><h4>Ringkasan tanggal aktif</h4>
          <div class="split-row"><span>File</span><strong>${escapeHtml(imported?.file_name || "Belum diimpor")}</strong></div>
          <div class="split-row"><span>Penjualan produk</span><strong>${rupiah(summary.productSales)}</strong></div>
          <div class="split-row"><span>Modal</span><strong>${rupiah(summary.capital)}</strong></div>
          <div class="split-row"><span>Laba kotor</span><strong>${rupiah(summary.grossProfit)}</strong></div>
          <div class="split-row"><span>Transaksi / Item</span><strong>${summary.transactions} / ${summary.items}</strong></div>
          <div class="split-row"><span>Ongkos kirim</span><strong>${rupiah(summary.shipping)}</strong></div>
        </article>
      </section>
      <section class="card section-gap"><div class="section-title-row"><h4>Produk terjual</h4><div class="button-row">${imported ? `<button class="button primary small" data-action="add-product" data-id="${imported.id}">Tambah manual</button><button class="button danger small" data-action="delete-import" data-id="${imported.id}">Hapus seluruh import</button>` : ""}</div></div><div class="notice info">Modal satuan dihitung dari data impor dan dapat disesuaikan. Mengubah item atau modal satuan akan menghitung ulang modal total dan laba.</div><div class="table-wrap"><table><thead><tr><th>Produk</th><th>Penjualan</th><th>Item</th><th>Modal/satuan</th><th>Laba</th><th>Modal total</th><th>Aksi</th></tr></thead><tbody>${productRows}</tbody></table></div></section>
      <section class="grid two section-gap">
        <article class="card"><div class="section-title-row"><h4>Gaji & bonus yang dipotong</h4><div class="button-row"><button class="button primary small" data-action="add-salary">Tambah</button><button class="button edit small" data-go="salary">Riwayat gaji</button></div></div><div class="table-wrap"><table><thead><tr><th>Jenis</th><th>Karyawan</th><th>Pokok</th><th>Bonus</th><th>Total</th><th>Aksi</th></tr></thead><tbody>${salaryDeductions}</tbody></table></div></article>
        <article class="card"><div class="section-title-row"><h4>Pengeluaran yang dipotong</h4><div class="button-row"><button class="button primary small" data-action="add-expense">Tambah</button><button class="button edit small" data-go="expenses">Riwayat pengeluaran</button></div></div><div class="table-wrap"><table><thead><tr><th>Jenis</th><th>Karyawan</th><th>Kategori</th><th>Catatan</th><th>Total</th><th>Aksi</th></tr></thead><tbody>${expenseDeductions}</tbody></table></div></article>
      </section>
      <section class="card section-gap"><h4>Finalisasi laporan</h4><div class="notice ${summary.deficit > 0 ? "danger-note" : "info"}"><strong>${summary.deficit > 0 ? `Defisit ${rupiah(summary.deficit)}` : `Total potongan ${rupiah(summary.salary + summary.expenses + summary.fixedAllocations)}`}</strong><br>Gaji & bonus ${rupiah(summary.salary)} + semua pengeluaran ${rupiah(summary.expenses)} + alokasi tetap ${rupiah(summary.fixedAllocations)}.</div><p class="muted">Data gaji tetap masuk Riwayat Gaji. Data pengeluaran tetap masuk Riwayat Pengeluaran.</p><button class="button success" data-action="close-book" ${imported && !locked ? "" : "disabled"}>${report ? "Perbarui dan kunci kembali" : "Simpan dan kunci tutup buku"}</button></section>`;
  }

  function renderSalary() {
    const saved = new Map(currentSalaries().map(row => [row.employee_id, row]));
    const employees = activeEmployees();
    const salaryRows = employees.length ? employees.map(employee => {
      const row = saved.get(employee.id) || {};
      const present = row.present === undefined ? true : row.present;
      return `<div class="salary-line" data-employee="${employee.id}"><strong>${escapeHtml(employee.name)}</strong><label class="check-row"><input class="salary-present" type="checkbox" ${present ? "checked" : ""}> Masuk</label><input class="salary-base" type="number" min="0" value="${row.base_salary ?? employee.daily_salary}" aria-label="Gaji pokok ${escapeHtml(employee.name)}"><input class="salary-bonus" type="number" min="0" value="${num(row.bonus)}" aria-label="Bonus ${escapeHtml(employee.name)}"><strong class="salary-total">${rupiah(row.total ?? employee.daily_salary)}</strong><input class="salary-notes" value="${escapeHtml(row.notes || "")}" placeholder="Catatan"></div>`;
    }).join("") : '<div class="empty">Belum ada karyawan aktif.</div>';
    const options = employees.map(row => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join("");
    const ledger = salaryLedger().sort((a, b) => a.employee_name.localeCompare(b.employee_name, "id")).map(row => `<div class="split-row"><span><strong>${escapeHtml(row.employee_name)}</strong><br><small class="muted">Hak ${rupiah(row.earned)} · Diambil ${rupiah(row.withdrawn)}</small></span><strong class="positive">Sisa ${rupiah(row.balance)}</strong></div>`).join("") || '<div class="empty">Belum ada data.</div>';
    return `
      <div class="page-head"><div><h3>Gaji, bonus, dan pengambilan</h3><p>Hak gaji dicatat harian. Pengambilan hanya mengurangi saldo hak gaji.</p></div></div>
      <form id="salaryForm" class="card"><h4>Gaji dan bonus harian</h4>${salaryRows}<button class="button primary section-gap" type="submit">Simpan gaji harian</button></form>
      <section class="grid two section-gap">
        <form id="withdrawalForm" class="card"><h4>Pengambilan gaji</h4><div class="form-grid"><div class="field"><label>Karyawan</label><select id="withdrawEmployee" required>${options}</select></div><div class="field"><label>Nominal</label><input id="withdrawAmount" type="number" min="1" required></div><div class="field full"><label>Catatan</label><input id="withdrawNotes" placeholder="Keterangan pengambilan"></div></div><button class="button success section-gap" type="submit">Simpan pengambilan</button></form>
        <article class="card"><h4>Total gaji per karyawan</h4>${ledger}</article>
      </section>
      <section class="card section-gap"><h4>Riwayat gaji</h4><div class="search-row"><input id="salarySearch" type="search" placeholder="Cari nama karyawan"><select id="salarySort"><option value="az">Nama A–Z</option><option value="za">Nama Z–A</option><option value="newest">Tanggal terbaru</option></select></div><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Nama</th><th>Jenis</th><th>Gaji pokok</th><th>Bonus</th><th>Total</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody id="salaryHistory">${salaryHistoryRows("", "az")}</tbody></table></div></section>`;
  }

  function salaryHistoryRows(query, sortMode) {
    const earned = state.salaries.map(row => ({ id: row.id, source: "salary", date: row.salary_date, employee_name: row.employee_name, type: "Gaji harian", base: num(row.base_salary), bonus: num(row.bonus), total: num(row.total), notes: row.notes || "" }));
    const taken = state.withdrawals.map(row => ({ id: row.id, source: "withdrawal", date: row.withdrawal_date, employee_name: row.employee_name, type: "Pengambilan gaji", base: null, bonus: null, total: -num(row.amount), notes: row.notes || "" }));
    const rows = [...earned, ...taken].filter(row => !query || row.employee_name.toLowerCase().includes(query.toLowerCase()));
    rows.sort((a, b) => sortMode === "az" ? a.employee_name.localeCompare(b.employee_name, "id") || b.date.localeCompare(a.date) : sortMode === "za" ? b.employee_name.localeCompare(a.employee_name, "id") || b.date.localeCompare(a.date) : b.date.localeCompare(a.date));
    return rows.length ? rows.map(row => `<tr><td>${formatDate(row.date)}</td><td>${escapeHtml(row.employee_name)}</td><td>${row.type}</td><td>${row.base === null ? "-" : rupiah(row.base)}</td><td>${row.bonus === null ? "-" : rupiah(row.bonus)}</td><td class="${row.total < 0 ? "negative" : "positive"}">${row.total < 0 ? "− " : ""}${rupiah(Math.abs(row.total))}</td><td>${escapeHtml(row.notes || "-")}</td><td><div class="button-row"><button class="button edit small" data-action="edit-${row.source}" data-id="${row.id}">Edit</button><button class="button danger small" data-action="delete-${row.source}" data-id="${row.id}">Hapus</button></div></td></tr>`).join("") : '<tr><td colspan="8" class="empty">Data tidak ditemukan.</td></tr>';
  }

  function renderExpenses() {
    const todayRows = currentExpenses();
    const summary = calculation();
    const employeeOptions = activeEmployees().map(row => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join("");
    const categoryOptions = state.categories.filter(row => row.active).map(row => `<option value="${escapeHtml(row.name)}">${escapeHtml(row.name)}</option>`).join("");
    const history = state.expenses.length ? [...state.expenses].sort(byNewest).map(row => `<tr><td>${formatDate(row.expense_date)}</td><td>${row.expense_type === "employee" ? "Karyawan" : "Operasional"}</td><td>${escapeHtml(row.employee_name || "-")}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.description || "-")}</td><td>${rupiah(row.amount)}</td><td><div class="button-row"><button class="button edit small" data-action="edit-expense" data-id="${row.id}">Edit</button><button class="button danger small" data-action="delete-expense" data-id="${row.id}">Hapus</button></div></td></tr>`).join("") : '<tr><td colspan="7" class="empty">Belum ada riwayat pengeluaran.</td></tr>';
    return `
      <div class="page-head"><div><h3>Pengeluaran</h3><p>Semua pengeluaran mengurangi laba pada tanggal pencatatan.</p></div></div>
      <section class="grid metric-grid">${metric("Total hari ini", rupiah(summary.expenses), "negative")}${metric("Terkait karyawan", rupiah(summary.employeeExpenses))}${metric("Jumlah catatan", todayRows.length)}${metric("Tanggal", formatDate(currentDate()))}</section>
      <form id="expenseForm" class="card"><h4>Catat pengeluaran</h4><div class="notice">Memilih nama karyawan hanya menandai penerima atau pengguna dana. Catatan ini tetap berbeda dari gaji dan tidak mengurangi saldo gaji.</div><div class="form-grid"><div class="field"><label>Kategori</label><select id="expenseCategory" required>${categoryOptions || '<option value="Lainnya">Lainnya</option>'}</select></div><div class="field"><label>Karyawan (opsional)</label><select id="expenseEmployee"><option value="">Bukan pengeluaran karyawan</option>${employeeOptions}</select></div><div class="field"><label>Nominal</label><input id="expenseAmount" type="number" min="1" required></div><div class="field"><label>Keterangan</label><input id="expenseDescription" placeholder="Catatan penggunaan dana"></div></div><button class="button primary section-gap" type="submit">Simpan pengeluaran</button></form>
      <section class="card section-gap"><h4>Riwayat semua pengeluaran</h4><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Jenis</th><th>Karyawan</th><th>Kategori</th><th>Keterangan</th><th>Nominal</th><th>Aksi</th></tr></thead><tbody>${history}</tbody></table></div></section>`;
  }

  function monthlyData() {
    const month = state.reportMonth;
    const reports = state.reports.filter(row => row.report_date.startsWith(month)).sort((a, b) => a.report_date.localeCompare(b.report_date));
    const date = new Date(`${month}-01T00:00:00`); date.setMonth(date.getMonth() - 1);
    const previousMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const previousReports = state.reports.filter(row => row.report_date.startsWith(previousMonth));
    const sales = sum(reports, "product_sales"), previousSales = sum(previousReports, "product_sales");
    return { month, reports, sales, previousSales, change: previousSales ? (sales - previousSales) / previousSales * 100 : null, capital: sum(reports, "capital"), profit: sum(reports, "gross_profit"), salary: sum(reports, "salary"), expenses: sum(reports, "expenses"), owner: sum(reports, "owner_result") };
  }

  function expectedCashForDate(date) {
    const imported = state.imports.find(row => row.report_date === date);
    const previous = state.cash.filter(row => row.report_date < date).sort((a, b) => b.report_date.localeCompare(a.report_date))[0];
    const opening = num(previous?.actual_cash);
    const receipts = num(imported?.source_total_sales || (num(imported?.product_sales) + num(imported?.shipping)));
    const expenseOut = state.expenses.filter(row => row.expense_date === date).reduce((total, row) => total + num(row.amount), 0);
    const salaryOut = state.withdrawals.filter(row => row.withdrawal_date === date).reduce((total, row) => total + num(row.amount), 0);
    const allocationOut = state.allocationWithdrawals.filter(row => row.withdrawal_date === date).reduce((total, row) => total + num(row.amount), 0);
    return { opening, receipts, expenseOut, salaryOut, allocationOut, expected: opening + receipts - expenseOut - salaryOut - allocationOut };
  }

  function allocationBalances() {
    const map = new Map();
    state.reports.forEach(report => (Array.isArray(report.allocation_json) ? report.allocation_json : []).filter(row => ["fixed", "percent"].includes(row.type)).forEach(row => {
      const item = map.get(row.name) || { name: row.name, earned: 0, withdrawn: 0 };
      item.earned += num(row.amount); map.set(row.name, item);
    }));
    state.allocationWithdrawals.forEach(row => {
      const item = map.get(row.allocation_name) || { name: row.allocation_name, earned: 0, withdrawn: 0 };
      item.withdrawn += num(row.amount); map.set(row.allocation_name, item);
    });
    return [...map.values()].map(row => ({ ...row, balance: row.earned - row.withdrawn })).sort((a, b) => a.name.localeCompare(b.name));
  }

  function renderReports() {
    const month = monthlyData();
    const maxSales = Math.max(1, ...month.reports.map(row => num(row.product_sales)));
    const chart = month.reports.length ? month.reports.map(row => `<div class="bar-column"><div class="bar-value">${rupiah(row.product_sales)}</div><div class="bar" style="height:${Math.max(5, num(row.product_sales) / maxSales * 150)}px"></div><small>${String(row.report_date).slice(8,10)}</small></div>`).join("") : '<div class="empty">Belum ada laporan pada bulan ini.</div>';
    const rows = month.reports.length ? month.reports.map(row => `<tr><td>${formatDate(row.report_date)}</td><td>${rupiah(row.product_sales)}</td><td>${rupiah(row.capital)}</td><td>${rupiah(row.gross_profit)}</td><td>${rupiah(row.salary)}</td><td>${rupiah(row.expenses)}</td><td>${rupiah(row.owner_result)}</td></tr>`).join("") : '<tr><td colspan="7" class="empty">Belum ada laporan.</td></tr>';
    const balances = allocationBalances();
    const balanceRows = balances.length ? balances.map(row => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${rupiah(row.earned)}</td><td>${rupiah(row.withdrawn)}</td><td><strong>${rupiah(row.balance)}</strong></td></tr>`).join("") : '<tr><td colspan="4" class="empty">Belum ada saldo alokasi.</td></tr>';
    const productMap = new Map();
    state.products.filter(row => row.report_date.startsWith(month.month)).forEach(row => { const item = productMap.get(row.product) || { name: row.product, items: 0, sales: 0, profit: 0 }; item.items += num(row.items); item.sales += num(row.sales); item.profit += num(row.profit); productMap.set(row.product, item); });
    const topProducts = [...productMap.values()].sort((a, b) => b.items - a.items).slice(0, 10);
    const topRows = topProducts.length ? topProducts.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${escapeHtml(row.name)}</strong></td><td>${row.items.toLocaleString("id-ID")}</td><td>${rupiah(row.sales)}</td><td>${rupiah(row.profit)}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">Belum ada produk.</td></tr>';
    const withdrawalRows = state.allocationWithdrawals.length ? state.allocationWithdrawals.map(row => `<tr><td>${formatDate(row.withdrawal_date)}</td><td>${escapeHtml(row.allocation_name)}</td><td>${rupiah(row.amount)}</td><td>${escapeHtml(row.notes || "-")}</td><td><button class="button danger small" data-action="delete-allocation-withdrawal" data-id="${row.id}">Hapus</button></td></tr>`).join("") : '<tr><td colspan="5" class="empty">Belum ada pengambilan alokasi.</td></tr>';
    const cashPosition = expectedCashForDate(currentDate());
    const expected = cashPosition.expected;
    const currentCash = state.cash.find(row => row.report_date === currentDate());
    const cashRows = state.cash.length ? state.cash.map(row => `<tr><td>${formatDate(row.report_date)}</td><td>${rupiah(row.expected_cash)}</td><td>${rupiah(row.actual_cash)}</td><td class="${num(row.difference) < 0 ? "negative" : "positive"}">${rupiah(row.difference)}</td><td>${escapeHtml(row.notes || "-")}</td><td><button class="button danger small" data-action="delete-cash" data-id="${row.id}">Hapus</button></td></tr>`).join("") : '<tr><td colspan="6" class="empty">Belum ada pencocokan kas.</td></tr>';
    const ruleOptions = state.rules.filter(row => row.active).map(row => `<option value="${row.id}">${escapeHtml(row.name)}</option>`).join("");
    return `<div class="page-head"><div><h3>Laporan & Kas</h3><p>Rekap bulanan, saldo alokasi, pencocokan kas, dan backup.</p></div><label class="field"><span>Bulan laporan</span><input id="reportMonth" type="month" value="${month.month}"></label></div>
      <section class="grid metric-grid">${metric("Penjualan", rupiah(month.sales))}${metric("Modal", rupiah(month.capital))}${metric("Laba kotor", rupiah(month.profit), "positive")}${metric("Gaji", rupiah(month.salary), "negative")}${metric("Pengeluaran", rupiah(month.expenses), "negative")}${metric("Hasil pemilik", rupiah(month.owner), "positive")}${metric("Dibanding bulan lalu", month.change === null ? "Belum ada data" : `${month.change >= 0 ? "+" : ""}${month.change.toFixed(1)}%`, month.change !== null && month.change >= 0 ? "positive" : "negative")}</section>
      <section class="card"><div class="section-title-row"><h4>Grafik omzet harian</h4><div class="button-row"><button class="button primary small" data-action="export-excel">Export Excel</button><button class="button secondary small" data-action="print-report">Cetak / PDF</button><button class="button ghost small" data-action="backup-data">Backup data</button></div></div><div class="bar-chart">${chart}</div></section>
      <section class="card section-gap"><h4>Rekap bulan terpilih</h4><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Penjualan</th><th>Modal</th><th>Laba</th><th>Gaji</th><th>Pengeluaran</th><th>Pemilik</th></tr></thead><tbody>${rows}</tbody></table></div></section>
      <section class="card section-gap"><h4>10 produk terlaris</h4><div class="table-wrap"><table><thead><tr><th>Peringkat</th><th>Produk</th><th>Item</th><th>Penjualan</th><th>Laba</th></tr></thead><tbody>${topRows}</tbody></table></div></section>
      <section class="grid two section-gap"><form id="cashForm" class="card"><h4>Pencocokan kas ${formatDate(currentDate())}</h4><div class="notice info">Saldo awal ${rupiah(cashPosition.opening)} + penerimaan ${rupiah(cashPosition.receipts)} − pengeluaran ${rupiah(cashPosition.expenseOut)} − pengambilan gaji ${rupiah(cashPosition.salaryOut)} − pengambilan alokasi ${rupiah(cashPosition.allocationOut)}.</div><div class="form-grid"><div class="field"><label>Kas menurut sistem</label><input id="expectedCash" type="number" value="${expected}" readonly></div><div class="field"><label>Kas yang dihitung</label><input id="actualCash" type="number" min="0" value="${num(currentCash?.actual_cash)}" required></div><div class="field full"><label>Catatan selisih</label><input id="cashNotes" value="${escapeHtml(currentCash?.notes || "")}" placeholder="Wajib jika ada selisih"></div></div><button class="button primary section-gap" type="submit">Simpan pencocokan</button></form>
      <form id="allocationWithdrawalForm" class="card"><h4>Ambil dana alokasi</h4><div class="form-grid"><div class="field"><label>Alokasi</label><select id="allocationRule" required>${ruleOptions}</select></div><div class="field"><label>Nominal</label><input id="allocationAmount" type="number" min="1" required></div><div class="field full"><label>Catatan</label><input id="allocationNotes" required placeholder="Tujuan pengambilan"></div></div><button class="button primary section-gap" type="submit">Simpan pengambilan</button></form></section>
      <section class="card section-gap"><h4>Saldo alokasi</h4><div class="table-wrap"><table><thead><tr><th>Alokasi</th><th>Terkumpul</th><th>Diambil</th><th>Saldo</th></tr></thead><tbody>${balanceRows}</tbody></table></div></section>
      <section class="card section-gap"><h4>Riwayat pengambilan alokasi</h4><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Alokasi</th><th>Nominal</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody>${withdrawalRows}</tbody></table></div></section>
      <section class="card section-gap"><h4>Riwayat pencocokan kas</h4><div class="table-wrap"><table><thead><tr><th>Tanggal</th><th>Sistem</th><th>Aktual</th><th>Selisih</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody>${cashRows}</tbody></table></div></section>`;
  }

  function renderMaster() {
    const employees = state.employees.length ? state.employees.map(row => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${rupiah(row.daily_salary)}</td><td><span class="pill ${row.active ? "" : "off"}">${row.active ? "Aktif" : "Nonaktif"}</span></td><td><div class="button-row"><button class="button edit small" data-action="edit-employee" data-id="${row.id}">Edit</button><button class="button ${row.active ? "variant" : "success"} small" data-action="toggle-employee" data-id="${row.id}" data-active="${!row.active}">${row.active ? "Nonaktifkan" : "Aktifkan"}</button><button class="button danger small" data-action="delete-employee" data-id="${row.id}">Hapus</button></div></td></tr>`).join("") : '<tr><td colspan="4" class="empty">Belum ada karyawan.</td></tr>';
    const rules = state.rules.length ? state.rules.map(row => `<tr><td>${row.sort_order}</td><td><strong>${escapeHtml(row.name)}</strong></td><td>${row.rule_type === "fixed" ? "Nominal tetap" : "Persentase"}</td><td>${row.allocation_target === "owner" || (!row.allocation_target && /pemilik/i.test(row.name)) ? "Pemilik" : "Dana/kebutuhan lain"}</td><td>${row.rule_type === "fixed" ? rupiah(row.value) : `${num(row.value)}%`}</td><td><span class="pill ${row.active ? "" : "off"}">${row.active ? "Aktif" : "Nonaktif"}</span></td><td><div class="button-row"><button class="button edit small" data-action="edit-rule" data-id="${row.id}">Edit</button><button class="button ${row.active ? "variant" : "success"} small" data-action="toggle-rule" data-id="${row.id}" data-active="${!row.active}">${row.active ? "Nonaktifkan" : "Aktifkan"}</button><button class="button danger small" data-action="delete-rule" data-id="${row.id}">Hapus</button></div></td></tr>`).join("") : '<tr><td colspan="7" class="empty">Belum ada aturan.</td></tr>';
    const categories = state.categories.length ? state.categories.map(row => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td><span class="pill ${row.active ? "" : "off"}">${row.active ? "Aktif" : "Nonaktif"}</span></td><td><div class="button-row"><button class="button edit small" data-action="edit-category" data-id="${row.id}">Edit</button><button class="button variant small" data-action="toggle-category" data-id="${row.id}" data-active="${!row.active}">${row.active ? "Nonaktifkan" : "Aktifkan"}</button><button class="button danger small" data-action="delete-category" data-id="${row.id}">Hapus</button></div></td></tr>`).join("") : '<tr><td colspan="3" class="empty">Belum ada kategori.</td></tr>';
    const profiles = state.profiles.length ? state.profiles.map(row => `<tr><td>${escapeHtml(row.full_name || "-")}</td><td>${escapeHtml(row.email || "-")}</td><td><span class="pill">${escapeHtml(row.role)}</span></td><td>${row.active ? "Aktif" : "Nonaktif"}</td><td>${canManageUsers() ? `<button class="button edit small" data-action="edit-profile" data-id="${row.id}">Atur akses</button>` : "-"}</td></tr>`).join("") : '<tr><td colspan="5" class="empty">Belum ada pengguna.</td></tr>';
    const auditRows = state.audits.length ? state.audits.map(row => { const profile = state.profiles.find(item => item.id === row.user_id); return `<tr><td>${formatTimestamp(row.created_at)}</td><td>${escapeHtml(profile?.full_name || profile?.email || "Sistem")}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.table_name)}</td><td>${escapeHtml(row.record_id || "-")}</td></tr>`; }).join("") : '<tr><td colspan="5" class="empty">Audit hanya dapat dilihat Admin dan Superadmin.</td></tr>';
    return `
      <div class="page-head"><div><h3>Kelola data</h3><p>Atur identitas toko, karyawan, dan pembagian laba.</p></div></div>
      <section class="grid two">
        <form id="settingsForm" class="card"><h4>Pengaturan toko</h4><div class="field"><label>Nama toko</label><input id="storeName" value="${escapeHtml(state.settings.store_name)}" required></div><button class="button primary section-gap" type="submit">Simpan pengaturan</button></form>
        <form id="employeeForm" class="card"><h4>Tambah karyawan</h4><div class="form-grid"><div class="field"><label>Nama</label><input id="employeeName" required></div><div class="field"><label>Gaji harian bawaan</label><input id="employeeSalary" type="number" min="0" value="60000" required></div></div><button class="button primary section-gap" type="submit">Tambah karyawan</button></form>
      </section>
      <section class="card section-gap"><h4>Daftar karyawan</h4><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Gaji harian</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${employees}</tbody></table></div></section>
      <section class="grid two section-gap">
        <form id="ruleForm" class="card"><h4>Tambah aturan pembagian</h4><div class="form-grid"><div class="field full"><label>Nama alokasi</label><input id="ruleName" required placeholder="Contoh: Dana darurat"></div><div class="field"><label>Jenis</label><select id="ruleType"><option value="fixed">Nominal tetap</option><option value="percent">Persentase</option></select></div><div class="field"><label>Dialokasikan untuk</label><select id="ruleTarget"><option value="other">Dana/kebutuhan lain</option><option value="owner">Pemilik</option></select></div><div class="field"><label>Nilai</label><input id="ruleValue" type="number" min="0" step="0.01" required></div><div class="field"><label>Urutan</label><input id="ruleOrder" type="number" min="1" value="99" required></div></div><button class="button primary section-gap" type="submit">Tambah aturan</button></form>
        <article class="card"><h4>Urutan pembagian</h4><div class="notice info">Nominal tetap dikurangi lebih dahulu. Sisa laba kemudian dibagi menggunakan aturan persentase aktif. Jumlah persentase idealnya 100%.</div></article>
      </section>
      <section class="card section-gap"><h4>Aturan pembagian laba</h4><div class="table-wrap"><table><thead><tr><th>Urutan</th><th>Nama</th><th>Jenis</th><th>Tujuan</th><th>Nilai</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rules}</tbody></table></div></section>
      <section class="card section-gap"><div class="section-title-row"><h4>Kategori pengeluaran</h4><button class="button primary small" data-action="add-category">Tambah kategori</button></div><div class="table-wrap"><table><thead><tr><th>Nama kategori</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${categories}</tbody></table></div></section>
      <section class="card section-gap"><h4>Pengguna & role</h4><div class="notice info">Akun baru dibuat melalui Supabase Authentication, kemudian role-nya dapat diatur oleh Superadmin di sini.</div><div class="table-wrap"><table><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${profiles}</tbody></table></div></section>
      <section class="card section-gap"><h4>100 aktivitas terakhir</h4><div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Data</th><th>ID</th></tr></thead><tbody>${auditRows}</tbody></table></div></section>`;
  }

  function bindPageEvents() {
    $("#mainContent").onclick = handleAction;
    if ($("#importForm")) $("#importForm").onsubmit = importReport;
    if ($("#griyoFile")) $("#griyoFile").onchange = parseGriyoFile;
    if ($("#salaryForm")) $("#salaryForm").onsubmit = saveSalaries;
    if ($("#withdrawalForm")) $("#withdrawalForm").onsubmit = saveWithdrawal;
    if ($("#expenseForm")) $("#expenseForm").onsubmit = saveExpense;
    if ($("#settingsForm")) $("#settingsForm").onsubmit = saveSettings;
    if ($("#employeeForm")) $("#employeeForm").onsubmit = saveEmployee;
    if ($("#ruleForm")) $("#ruleForm").onsubmit = saveRule;
    if ($("#cashForm")) $("#cashForm").onsubmit = saveCash;
    if ($("#allocationWithdrawalForm")) $("#allocationWithdrawalForm").onsubmit = saveAllocationWithdrawal;
    if ($("#reportMonth")) $("#reportMonth").onchange = event => { state.reportMonth = event.target.value || localDate().slice(0, 7); renderPage(); };
    $$(".salary-present, .salary-base, .salary-bonus").forEach(input => input.oninput = updateSalaryTotal);
    $$(".item-input, .unit-capital-input").forEach(input => input.oninput = updateProductCostPreview);
    if ($("#salarySearch")) $("#salarySearch").oninput = filterSalaryHistory;
    if ($("#salarySort")) $("#salarySort").onchange = filterSalaryHistory;
  }

  function updateSalaryTotal(event) {
    const row = event.target.closest(".salary-line");
    const total = $(".salary-present", row).checked ? num($(".salary-base", row).value) + num($(".salary-bonus", row).value) : 0;
    $(".salary-total", row).textContent = rupiah(total);
  }
  function updateProductCostPreview(event) {
    const row = event.target.closest("[data-product-row]");
    if (!row) return;
    const items = num($(".item-input", row).value);
    const unitCapital = num($(".unit-capital-input", row).value);
    const capital = items * unitCapital;
    $(".live-capital", row).textContent = rupiah(capital);
    $(".live-profit", row).textContent = rupiah(num(row.dataset.sales) - capital);
  }
  function filterSalaryHistory() {
    $("#salaryHistory").innerHTML = salaryHistoryRows($("#salarySearch").value.trim(), $("#salarySort").value);
  }

  async function handleAction(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.dataset.go) return changePage(button.dataset.go);
    const { action, id } = button.dataset;
    try {
      if (action === "save-item") await saveItem(id);
      if (action === "add-product") await addProduct(id);
      if (action === "edit-product") await editProduct(id);
      if (action === "delete-product") await deleteProduct(id);
      if (action === "delete-import") await deleteImport(id);
      if (action === "close-book") await closeBook();
      if (action === "reopen-book") await reopenBook();
      if (action === "add-salary") await addSalaryQuick();
      if (action === "edit-salary") await editSalary(id);
      if (action === "delete-salary") await deleteSalary(id);
      if (action === "edit-withdrawal") await editWithdrawal(id);
      if (action === "delete-withdrawal") await deleteRecord("salary_withdrawals", id, "Riwayat pengambilan gaji");
      if (action === "add-expense") await addExpenseQuick();
      if (action === "edit-expense") await editExpense(id);
      if (action === "delete-expense") await deleteExpense(id);
      if (action === "edit-employee") await editEmployee(id);
      if (action === "delete-employee") await deleteRecord("employees", id, "Karyawan");
      if (action === "edit-rule") await editRule(id);
      if (action === "delete-rule") await deleteRecord("allocation_rules", id, "Aturan");
      if (action === "delete-report") await deleteRecord("daily_reports", id, "Laporan tutup buku");
      if (action === "toggle-employee") await toggleRecord("employees", id, button.dataset.active === "true");
      if (action === "toggle-rule") await toggleRecord("allocation_rules", id, button.dataset.active === "true");
      if (action === "add-category") await addCategory();
      if (action === "edit-category") await editCategory(id);
      if (action === "toggle-category") await toggleRecord("expense_categories", id, button.dataset.active === "true");
      if (action === "delete-category") await deleteRecord("expense_categories", id, "Kategori");
      if (action === "edit-profile") await editProfile(id);
      if (action === "delete-allocation-withdrawal") await deleteRecord("allocation_withdrawals", id, "Pengambilan alokasi");
      if (action === "delete-cash") await deleteRecord("cash_reconciliations", id, "Pencocokan kas");
      if (action === "export-excel") exportMonthlyExcel();
      if (action === "print-report") printMonthlyReport();
      if (action === "backup-data") backupData();
    } catch (error) { toast(error.message, "error"); }
  }

  async function parseGriyoFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const workbook = XLSX.read(await file.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null });
      const headerIndex = rows.findIndex(row => row.map(value => String(value || "").trim().toLowerCase()).includes("produk"));
      if (headerIndex < 0) throw new Error("Kolom Produk tidak ditemukan.");
      const headers = rows[headerIndex].map(value => String(value || "").trim().toLowerCase());
      const column = name => headers.indexOf(name);
      const products = [];
      let sourceTotalSales = 0, transactions = 0, items = 0, shipping = 0;
      rows.slice(headerIndex + 1).forEach(row => {
        const product = String(row[column("produk")] || "").trim();
        const lower = product.toLowerCase();
        if (!product) return;
        if (lower === "total") {
          sourceTotalSales = num(row[column("penjualan")]);
          transactions = num(row[column("transaksi")]);
          items = num(row[column("item")]);
          return;
        }
        if (lower.includes("ongkos kirim")) { shipping += num(row[column("penjualan")]); return; }
        const sales = num(row[column("penjualan")]);
        const productItems = num(row[column("item")]);
        const profit = num(row[column("laba")]);
        const capital = sales - profit;
        products.push({
          product, sales, transactions: num(row[column("transaksi")]), items: productItems,
          discount: num(row[column("diskon")]), profit, capital,
          unit_capital: productItems > 0 ? capital / productItems : 0
        });
      });
      if (!products.length) throw new Error("Data produk tidak ditemukan.");
      const fileDate = file.name.match(/\d{4}-\d{2}-\d{2}/)?.[0];
      if (fileDate && fileDate !== currentDate()) throw new Error(`Tanggal file ${formatDate(fileDate)} berbeda dari tanggal aktif ${formatDate(currentDate())}.`);
      const duplicateNames = products.map(row => row.product.trim().toLowerCase()).filter((name, index, all) => all.indexOf(name) !== index);
      if (duplicateNames.length) throw new Error(`Produk duplikat ditemukan: ${[...new Set(duplicateNames)].join(", ")}.`);
      const invalidProfit = products.find(row => row.profit > row.sales);
      if (invalidProfit) throw new Error(`Laba ${invalidProfit.product} lebih besar daripada penjualannya.`);
      const productSales = sum(products, "sales");
      const grossProfit = sum(products, "profit");
      const expectedTotal = productSales + shipping;
      if (sourceTotalSales && Math.abs(sourceTotalSales - expectedTotal) > 1) throw new Error(`Total file tidak cocok. Ringkasan ${rupiah(sourceTotalSales)}, sedangkan produk + ongkos kirim ${rupiah(expectedTotal)}.`);
      state.parsedImport = { file, products, sourceTotalSales, productSales, grossProfit, capital: productSales - grossProfit, transactions, items: items || sum(products, "items"), shipping, discount: sum(products, "discount") };
      $("#importInfo").innerHTML = `<strong>${products.length} produk terbaca.</strong><br>Penjualan ${rupiah(productSales)} · Laba ${rupiah(grossProfit)} · Modal ${rupiah(productSales - grossProfit)}.`;
      $("#importButton").disabled = false;
    } catch (error) { state.parsedImport = null; $("#importButton").disabled = true; toast(error.message, "error"); }
  }

  async function importReport(event) {
    event.preventDefault();
    ensureUnlocked();
    if (!state.parsedImport) return;
    setLoading(true);
    try {
      const parsed = state.parsedImport;
      const imported = assertResult(await db.from("sales_imports").upsert({
        report_date: currentDate(), file_name: parsed.file.name, product_sales: parsed.productSales,
        source_total_sales: parsed.sourceTotalSales, shipping: parsed.shipping, transactions: parsed.transactions,
        items: parsed.items, discount: parsed.discount, gross_profit: parsed.grossProfit, capital: parsed.capital,
        imported_at: new Date().toISOString()
      }, { onConflict: "report_date" }).select().single());
      assertResult(await db.from("import_products").delete().eq("import_id", imported.id));
      assertResult(await db.from("import_products").insert(parsed.products.map(row => ({
        import_id: imported.id, report_date: currentDate(), product: row.product, sales: row.sales,
        transactions: row.transactions, items: row.items, discount: row.discount, profit: row.profit,
        unit_capital: row.unit_capital, capital: row.capital
      }))));
      state.parsedImport = null;
      toast("Laporan Griyo Pos berhasil diimpor.");
      await loadData();
    } catch (error) { toast(error.message, "error"); } finally { setLoading(false); }
  }

  async function saveItem(id) {
    ensureUnlocked();
    const input = $(`.item-input[data-id="${id}"]`);
    const unitInput = $(`.unit-capital-input[data-id="${id}"]`);
    const items = num(input.value);
    const unitCapital = num(unitInput.value);
    const row = state.products.find(item => item.id === id);
    if (!row || items < 0 || unitCapital < 0) throw new Error("Jumlah item atau modal satuan tidak valid.");
    const capital = items * unitCapital;
    const profit = num(row.sales) - capital;
    assertResult(await db.from("import_products").update({ items, unit_capital: unitCapital, capital, profit }).eq("id", id));
    await refreshImportTotals(row.import_id);
    toast("Item, modal, dan laba diperbarui.");
    await loadData();
  }

  async function refreshImportTotals(importId) {
    const rows = assertResult(await db.from("import_products").select("sales,profit,capital,items,discount").eq("import_id", importId));
    const productSales = sum(rows, "sales");
    const grossProfit = sum(rows, "profit");
    assertResult(await db.from("sales_imports").update({ product_sales: productSales, gross_profit: grossProfit, capital: sum(rows, "capital"), items: sum(rows, "items"), discount: sum(rows, "discount") }).eq("id", importId));
  }

  async function addProduct(importId) {
    ensureUnlocked();
    const data = await openFormModal("Tambah produk manual", [
      { name: "product", label: "Nama produk", required: true, full: true },
      { name: "sales", label: "Penjualan", type: "number", min: 0, required: true },
      { name: "items", label: "Jumlah item", type: "number", min: 0, step: .01, required: true },
      { name: "unit_capital", label: "Modal per satuan", type: "number", min: 0, step: .0001, required: true },
      { name: "discount", label: "Diskon", type: "number", min: 0, value: 0, required: true }
    ], "Tambah produk");
    if (!data) return;
    const sales = num(data.sales), items = num(data.items), unitCapital = num(data.unit_capital);
    const capital = items * unitCapital, profit = sales - capital;
    assertResult(await db.from("import_products").insert({ import_id: importId, report_date: currentDate(), product: data.product.trim(), sales, transactions: 0, items, discount: num(data.discount), unit_capital: unitCapital, profit, capital }));
    await refreshImportTotals(importId); toast("Produk ditambahkan."); await loadData();
  }

  async function editProduct(id) {
    ensureUnlocked();
    const row = state.products.find(item => item.id === id); if (!row) return;
    const data = await openFormModal("Edit produk", [
      { name: "product", label: "Nama produk", value: row.product, required: true, full: true },
      { name: "sales", label: "Penjualan", type: "number", min: 0, value: row.sales, required: true },
      { name: "items", label: "Jumlah item", type: "number", min: 0, step: .01, value: row.items, required: true },
      { name: "unit_capital", label: "Modal per satuan", type: "number", min: 0, step: .0001, value: row.unit_capital, required: true },
      { name: "discount", label: "Diskon", type: "number", min: 0, value: row.discount, required: true }
    ]);
    if (!data) return;
    const sales = num(data.sales), items = num(data.items), unitCapital = num(data.unit_capital);
    const capital = items * unitCapital, profit = sales - capital;
    assertResult(await db.from("import_products").update({ product: data.product.trim(), sales, items, unit_capital: unitCapital, profit, discount: num(data.discount), capital }).eq("id", id));
    await refreshImportTotals(row.import_id); toast("Produk diperbarui."); await loadData();
  }

  async function deleteProduct(id) {
    ensureUnlocked();
    const row = state.products.find(item => item.id === id); if (!row || !confirm(`Hapus produk ${row.product}?`)) return;
    assertResult(await db.from("import_products").delete().eq("id", id));
    await refreshImportTotals(row.import_id); toast("Produk dihapus."); await loadData();
  }

  async function deleteImport(id) {
    ensureUnlocked();
    if (!confirm("Hapus seluruh hasil import pada tanggal ini?")) return;
    assertResult(await db.from("sales_imports").delete().eq("id", id));
    toast("Data import dihapus."); await loadData();
  }

  async function saveSalaries(event) {
    event.preventDefault();
    ensureUnlocked();
    const rows = $$(".salary-line").map(element => {
      const employee = state.employees.find(row => row.id === element.dataset.employee);
      const present = $(".salary-present", element).checked;
      const base = present ? num($(".salary-base", element).value) : 0;
      const bonus = present ? num($(".salary-bonus", element).value) : 0;
      return { salary_date: currentDate(), employee_id: employee.id, employee_name: employee.name, present, base_salary: base, bonus, total: base + bonus, notes: $(".salary-notes", element).value.trim(), updated_at: new Date().toISOString() };
    });
    setLoading(true);
    try { assertResult(await db.from("salaries").upsert(rows, { onConflict: "salary_date,employee_id" })); toast("Gaji dan bonus tersimpan."); await loadData(); }
    catch (error) { toast(error.message, "error"); } finally { setLoading(false); }
  }

  async function saveWithdrawal(event) {
    event.preventDefault();
    const employee = state.employees.find(row => row.id === $("#withdrawEmployee").value);
    const amount = num($("#withdrawAmount").value);
    const ledger = salaryLedger().find(row => row.employee_id === employee?.id);
    if (!employee || amount <= 0) return toast("Karyawan dan nominal wajib diisi.", "error");
    if (amount > num(ledger?.balance)) return toast("Nominal melebihi sisa gaji karyawan.", "error");
    setLoading(true);
    try {
      assertResult(await db.from("salary_withdrawals").insert({ withdrawal_date: currentDate(), employee_id: employee.id, employee_name: employee.name, amount, notes: $("#withdrawNotes").value.trim() }));
      toast("Pengambilan gaji dicatat."); await loadData();
    } catch (error) { toast(error.message, "error"); } finally { setLoading(false); }
  }

  async function addSalaryQuick() {
    ensureUnlocked();
    const usedIds = new Set(currentSalaries().map(row => row.employee_id));
    const available = activeEmployees().filter(row => !usedIds.has(row.id));
    if (!available.length) return toast("Semua karyawan aktif sudah memiliki gaji pada tanggal ini.", "error");
    const data = await openFormModal("Tambah gaji & bonus", [
      { name: "employee_id", label: "Karyawan", type: "select", required: true, options: available.map(row => ({ value: row.id, label: row.name })) },
      { name: "base_salary", label: "Gaji pokok", type: "number", min: 0, value: available[0].daily_salary, required: true },
      { name: "bonus", label: "Bonus", type: "number", min: 0, value: 0, required: true },
      { name: "notes", label: "Catatan", type: "textarea", full: true }
    ], "Tambah gaji");
    if (!data) return;
    const employee = available.find(row => row.id === data.employee_id);
    const base = num(data.base_salary), bonus = num(data.bonus);
    assertResult(await db.from("salaries").insert({ salary_date: currentDate(), employee_id: employee.id, employee_name: employee.name, present: true, base_salary: base, bonus, total: base + bonus, notes: data.notes.trim(), updated_at: new Date().toISOString() }));
    toast("Gaji ditambahkan dan masuk ke riwayat gaji."); await loadData();
  }

  async function editSalary(id) {
    const row = state.salaries.find(item => item.id === id); if (!row) return;
    ensureDateUnlocked(row.salary_date);
    const data = await openFormModal(`Edit gaji ${row.employee_name}`, [
      { name: "base_salary", label: "Gaji pokok", type: "number", min: 0, value: row.base_salary, required: true },
      { name: "bonus", label: "Bonus", type: "number", min: 0, value: row.bonus, required: true },
      { name: "notes", label: "Catatan", type: "textarea", value: row.notes || "", full: true }
    ]);
    if (!data) return;
    const base = num(data.base_salary), bonus = num(data.bonus);
    assertResult(await db.from("salaries").update({ base_salary: base, bonus, total: base + bonus, notes: data.notes.trim(), updated_at: new Date().toISOString() }).eq("id", id));
    toast("Riwayat gaji diperbarui."); await loadData();
  }

  async function deleteSalary(id) {
    const row = state.salaries.find(item => item.id === id); if (!row) return;
    ensureDateUnlocked(row.salary_date);
    await deleteRecord("salaries", id, "Riwayat gaji");
  }

  async function editWithdrawal(id) {
    const row = state.withdrawals.find(item => item.id === id); if (!row) return;
    const data = await openFormModal(`Edit pengambilan ${row.employee_name}`, [
      { name: "amount", label: "Nominal pengambilan", type: "number", min: 1, value: row.amount, required: true },
      { name: "notes", label: "Catatan", type: "textarea", value: row.notes || "", full: true }
    ]);
    if (!data) return;
    assertResult(await db.from("salary_withdrawals").update({ amount: num(data.amount), notes: data.notes.trim() }).eq("id", id));
    toast("Pengambilan gaji diperbarui."); await loadData();
  }

  async function saveExpense(event) {
    event.preventDefault();
    ensureUnlocked();
    const employeeId = $("#expenseEmployee").value;
    const employee = state.employees.find(row => row.id === employeeId);
    setLoading(true);
    try {
      assertResult(await db.from("expenses").insert({ expense_date: currentDate(), expense_type: employee ? "employee" : "operational", employee_id: employee?.id || null, employee_name: employee?.name || null, category: $("#expenseCategory").value.trim(), description: $("#expenseDescription").value.trim(), amount: num($("#expenseAmount").value) }));
      toast("Pengeluaran tersimpan."); await loadData();
    } catch (error) { toast(error.message, "error"); } finally { setLoading(false); }
  }

  async function addExpenseQuick() {
    ensureUnlocked();
    const data = await openFormModal("Tambah pengeluaran", [
      { name: "category", label: "Kategori", type: "select", required: true, options: state.categories.filter(row => row.active).map(row => ({ value: row.name, label: row.name })) },
      { name: "amount", label: "Nominal", type: "number", min: 1, required: true },
      { name: "employee_id", label: "Karyawan terkait", type: "select", options: [{ value: "", label: "Bukan pengeluaran karyawan" }, ...activeEmployees().map(row => ({ value: row.id, label: row.name }))] },
      { name: "description", label: "Catatan", type: "textarea", full: true }
    ], "Tambah pengeluaran");
    if (!data) return;
    const employee = activeEmployees().find(row => row.id === data.employee_id);
    assertResult(await db.from("expenses").insert({ expense_date: currentDate(), expense_type: employee ? "employee" : "operational", employee_id: employee?.id || null, employee_name: employee?.name || null, category: data.category.trim(), description: data.description.trim(), amount: num(data.amount) }));
    toast("Pengeluaran ditambahkan dan masuk ke riwayat pengeluaran."); await loadData();
  }

  async function deleteExpense(id) {
    const row = state.expenses.find(item => item.id === id); if (row) ensureDateUnlocked(row.expense_date);
    if (!confirm("Hapus catatan pengeluaran ini?")) return;
    assertResult(await db.from("expenses").delete().eq("id", id));
    toast("Pengeluaran dihapus."); await loadData();
  }

  async function editExpense(id) {
    const row = state.expenses.find(item => item.id === id); if (!row) return;
    ensureDateUnlocked(row.expense_date);
    const data = await openFormModal("Edit pengeluaran", [
      { name: "category", label: "Kategori", type: "select", value: row.category, required: true, options: state.categories.map(item => ({ value: item.name, label: item.name })) },
      { name: "amount", label: "Nominal", type: "number", min: 1, value: row.amount, required: true },
      { name: "employee_id", label: "Karyawan terkait", type: "select", value: row.employee_id || "", options: [{ value: "", label: "Bukan pengeluaran karyawan" }, ...state.employees.map(item => ({ value: item.id, label: item.name }))] },
      { name: "description", label: "Catatan", type: "textarea", value: row.description || "", full: true }
    ]);
    if (!data) return;
    const employee = state.employees.find(item => item.id === data.employee_id);
    assertResult(await db.from("expenses").update({ category: data.category.trim(), amount: num(data.amount), description: data.description.trim(), expense_type: employee ? "employee" : "operational", employee_id: employee?.id || null, employee_name: employee?.name || null }).eq("id", id));
    toast("Pengeluaran diperbarui."); await loadData();
  }

  async function saveSettings(event) {
    event.preventDefault();
    setLoading(true);
    try { assertResult(await db.from("settings").update({ store_name: $("#storeName").value.trim(), updated_at: new Date().toISOString() }).eq("id", 1)); toast("Pengaturan disimpan."); await loadData(); }
    catch (error) { toast(error.message, "error"); } finally { setLoading(false); }
  }

  async function saveEmployee(event) {
    event.preventDefault();
    setLoading(true);
    try { assertResult(await db.from("employees").insert({ name: $("#employeeName").value.trim(), daily_salary: num($("#employeeSalary").value) })); toast("Karyawan ditambahkan."); await loadData(); }
    catch (error) { toast(error.message, "error"); } finally { setLoading(false); }
  }

  async function editEmployee(id) {
    const row = state.employees.find(item => item.id === id); if (!row) return;
    const data = await openFormModal("Edit karyawan", [
      { name: "name", label: "Nama karyawan", value: row.name, required: true },
      { name: "daily_salary", label: "Gaji harian bawaan", type: "number", min: 0, value: row.daily_salary, required: true }
    ]);
    if (!data) return;
    assertResult(await db.from("employees").update({ name: data.name.trim(), daily_salary: num(data.daily_salary) }).eq("id", id));
    toast("Data karyawan diperbarui."); await loadData();
  }

  async function saveRule(event) {
    event.preventDefault();
    setLoading(true);
    try { assertResult(await db.from("allocation_rules").insert({ name: $("#ruleName").value.trim(), rule_type: $("#ruleType").value, allocation_target: $("#ruleTarget").value, value: num($("#ruleValue").value), sort_order: num($("#ruleOrder").value), active: true })); toast("Aturan ditambahkan."); await loadData(); }
    catch (error) { toast(error.message, "error"); } finally { setLoading(false); }
  }

  async function editRule(id) {
    const row = state.rules.find(item => item.id === id); if (!row) return;
    const data = await openFormModal("Edit aturan pembagian", [
      { name: "name", label: "Nama alokasi", value: row.name, required: true, full: true },
      { name: "rule_type", label: "Jenis", type: "select", value: row.rule_type, options: [{ value: "fixed", label: "Nominal tetap" }, { value: "percent", label: "Persentase" }] },
      { name: "allocation_target", label: "Dialokasikan untuk", type: "select", value: row.allocation_target || (/pemilik/i.test(row.name) ? "owner" : "other"), options: [{ value: "other", label: "Dana/kebutuhan lain" }, { value: "owner", label: "Pemilik" }] },
      { name: "value", label: "Nilai", type: "number", min: 0, step: .01, value: row.value, required: true },
      { name: "sort_order", label: "Urutan", type: "number", min: 1, value: row.sort_order, required: true }
    ]);
    if (!data) return;
    assertResult(await db.from("allocation_rules").update({ name: data.name.trim(), rule_type: data.rule_type, allocation_target: data.allocation_target, value: num(data.value), sort_order: num(data.sort_order) }).eq("id", id));
    toast("Aturan diperbarui."); await loadData();
  }

  async function addCategory() {
    if (!canManageMaster()) throw new Error("Hanya Admin atau Superadmin yang dapat mengelola kategori.");
    const data = await openFormModal("Tambah kategori pengeluaran", [{ name: "name", label: "Nama kategori", required: true, full: true }], "Tambah kategori");
    if (!data) return;
    assertResult(await db.from("expense_categories").insert({ name: data.name.trim(), active: true }));
    toast("Kategori ditambahkan."); await loadData();
  }

  async function editCategory(id) {
    if (!canManageMaster()) throw new Error("Hanya Admin atau Superadmin yang dapat mengelola kategori.");
    const row = state.categories.find(item => item.id === id); if (!row) return;
    const data = await openFormModal("Edit kategori", [{ name: "name", label: "Nama kategori", value: row.name, required: true, full: true }]);
    if (!data) return;
    assertResult(await db.from("expense_categories").update({ name: data.name.trim() }).eq("id", id));
    toast("Kategori diperbarui."); await loadData();
  }

  async function editProfile(id) {
    if (!canManageUsers()) throw new Error("Hanya Superadmin yang dapat mengatur akses pengguna.");
    const row = state.profiles.find(item => item.id === id); if (!row) return;
    const data = await openFormModal("Atur akses pengguna", [
      { name: "full_name", label: "Nama", value: row.full_name || "", required: true },
      { name: "role", label: "Role", type: "select", value: row.role, options: [
        { value: "superadmin", label: "Superadmin" }, { value: "admin", label: "Admin" },
        { value: "staff", label: "Staff" }, { value: "viewer", label: "Viewer" }
      ] },
      { name: "active", label: "Status", type: "select", value: String(row.active), options: [{ value: "true", label: "Aktif" }, { value: "false", label: "Nonaktif" }] }
    ]);
    if (!data) return;
    if (row.id === state.profile.id && data.active === "false") throw new Error("Anda tidak dapat menonaktifkan akun sendiri.");
    assertResult(await db.from("profiles").update({ full_name: data.full_name.trim(), role: data.role, active: data.active === "true", updated_at: new Date().toISOString() }).eq("id", id));
    toast("Akses pengguna diperbarui."); await loadData();
  }

  async function deleteRecord(table, id, label) {
    if (!confirm(`Hapus ${label.toLowerCase()} ini?`)) return;
    assertResult(await db.from(table).delete().eq("id", id));
    toast(`${label} dihapus.`); await loadData();
  }

  async function toggleRecord(table, id, active) {
    assertResult(await db.from(table).update({ active }).eq("id", id));
    toast("Status diperbarui."); await loadData();
  }

  async function saveCash(event) {
    event.preventDefault();
    const expected = num($("#expectedCash").value), actual = num($("#actualCash").value);
    const difference = actual - expected, notes = $("#cashNotes").value.trim();
    if (difference !== 0 && !notes) throw new Error("Catatan wajib diisi jika terdapat selisih kas.");
    assertResult(await db.from("cash_reconciliations").upsert({ report_date: currentDate(), expected_cash: expected, actual_cash: actual, difference, notes, updated_at: new Date().toISOString() }, { onConflict: "report_date" }));
    toast("Pencocokan kas tersimpan."); await loadData();
  }

  async function saveAllocationWithdrawal(event) {
    event.preventDefault();
    const rule = state.rules.find(row => row.id === $("#allocationRule").value);
    const amount = num($("#allocationAmount").value);
    if (!rule || amount <= 0) throw new Error("Pilih alokasi dan isi nominal yang valid.");
    const balance = allocationBalances().find(row => row.name === rule.name)?.balance || 0;
    if (amount > balance) throw new Error(`Nominal melebihi saldo ${rule.name} (${rupiah(balance)}).`);
    assertResult(await db.from("allocation_withdrawals").insert({ withdrawal_date: currentDate(), allocation_rule_id: rule.id, allocation_name: rule.name, amount, notes: $("#allocationNotes").value.trim() }));
    toast("Pengambilan alokasi tersimpan."); await loadData();
  }

  function downloadBlob(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportMonthlyExcel() {
    const { month, reports } = monthlyData();
    const inMonth = value => String(value || "").startsWith(month);
    const workbook = XLSX.utils.book_new();
    const add = (name, rows) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows.length ? rows : [{ Keterangan: "Tidak ada data" }]), name);
    add("Ringkasan", reports.map(row => ({ Tanggal: row.report_date, Penjualan: num(row.product_sales), Modal: num(row.capital), Laba_Kotor: num(row.gross_profit), Gaji_Bonus: num(row.salary), Pengeluaran: num(row.expenses), Dasar_Alokasi: num(row.profit_to_share), Pemilik: num(row.owner_result) })));
    add("Produk", state.products.filter(row => inMonth(row.report_date)).map(row => ({ Tanggal: row.report_date, Produk: row.product, Penjualan: num(row.sales), Item: num(row.items), Modal_Satuan: num(row.unit_capital), Modal_Total: num(row.capital), Laba: num(row.profit) })));
    add("Gaji", state.salaries.filter(row => inMonth(row.salary_date)).map(row => ({ Tanggal: row.salary_date, Karyawan: row.employee_name, Gaji_Pokok: num(row.base_salary), Bonus: num(row.bonus), Total: num(row.total), Catatan: row.notes || "" })));
    add("Pengeluaran", state.expenses.filter(row => inMonth(row.expense_date)).map(row => ({ Tanggal: row.expense_date, Jenis: row.expense_type, Karyawan: row.employee_name || "", Kategori: row.category, Nominal: num(row.amount), Catatan: row.description || "" })));
    XLSX.writeFile(workbook, `Laporan-UD-Fikri-${month}.xlsx`);
  }

  function printMonthlyReport() {
    const month = monthlyData();
    const rows = month.reports.map(row => `<tr><td>${formatDate(row.report_date)}</td><td>${rupiah(row.product_sales)}</td><td>${rupiah(row.capital)}</td><td>${rupiah(row.gross_profit)}</td><td>${rupiah(row.salary)}</td><td>${rupiah(row.expenses)}</td><td>${rupiah(row.owner_result)}</td></tr>`).join("");
    const popup = window.open("", "_blank");
    if (!popup) throw new Error("Izinkan pop-up browser untuk mencetak laporan.");
    popup.document.write(`<html><head><title>Laporan UD Fikri ${month.month}</title><style>body{font-family:Arial;padding:28px;color:#163738}h1{margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:20px}th,td{padding:9px;border:1px solid #ccd;text-align:left}th{background:#e5f4f0}.summary{display:flex;gap:25px;flex-wrap:wrap;margin-top:18px}.summary b{display:block;font-size:18px}@media print{button{display:none}}</style></head><body><h1>UD Fikri</h1><div>Laporan bulan ${month.month}</div><div class="summary"><span>Penjualan<b>${rupiah(month.sales)}</b></span><span>Modal<b>${rupiah(month.capital)}</b></span><span>Laba<b>${rupiah(month.profit)}</b></span><span>Pemilik<b>${rupiah(month.owner)}</b></span></div><table><thead><tr><th>Tanggal</th><th>Penjualan</th><th>Modal</th><th>Laba</th><th>Gaji</th><th>Pengeluaran</th><th>Pemilik</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  }

  function backupData() {
    const backup = { exported_at: new Date().toISOString(), settings: state.settings, employees: state.employees, imports: state.imports, products: state.products, salaries: state.salaries, salary_withdrawals: state.withdrawals, expenses: state.expenses, allocation_rules: state.rules, daily_reports: state.reports, allocation_withdrawals: state.allocationWithdrawals, cash_reconciliations: state.cash, expense_categories: state.categories };
    downloadBlob(`Backup-UD-Fikri-${localDate()}.json`, JSON.stringify(backup, null, 2), "application/json");
  }

  async function closeBook() {
    ensureUnlocked();
    const imported = currentImport();
    if (!imported) throw new Error("Import laporan Griyo Pos terlebih dahulu.");
    const summary = calculation();
    assertResult(await db.from("daily_reports").upsert({
      report_date: currentDate(), file_name: imported.file_name, product_sales: summary.productSales,
      capital: summary.capital, gross_profit: summary.grossProfit, transactions: summary.transactions,
      items: summary.items, shipping: summary.shipping, salary: summary.salary, expenses: summary.expenses,
      fixed_allocations: summary.fixedAllocations, profit_to_share: summary.profitToShare,
      percentage_allocations: summary.percentageAllocations, owner_result: summary.ownerResult,
      allocation_json: summary.allocations, book_status: "closed", closed_at: new Date().toISOString(), reopened_at: null, saved_at: new Date().toISOString()
    }, { onConflict: "report_date" }));
    toast("Tutup buku harian tersimpan."); await loadData();
  }

  async function reopenBook() {
    const report = currentReport();
    if (!report) return;
    const data = await openFormModal(`Buka kembali ${formatDate(currentDate())}`, [{ name: "reason", label: "Alasan membuka kembali", type: "textarea", required: true, full: true, placeholder: "Contoh: koreksi jumlah item" }], "Buka kembali");
    if (!data) return;
    assertResult(await db.from("daily_reports").update({ book_status: "reopened", reopened_at: new Date().toISOString(), reopen_reason: data.reason.trim(), reopened_by: state.profile?.id || null }).eq("id", report.id));
    toast("Tutup buku dibuka kembali."); await loadData();
  }

  $("#loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    $("#loginMessage").textContent = "Memeriksa akun…";
    const { error } = await db.auth.signInWithPassword({ email: $("#loginEmail").value.trim(), password: $("#loginPassword").value });
    if (error) return $("#loginMessage").textContent = error.message;
    $("#loginMessage").textContent = "";
    await loadData();
  });
  $("#logoutButton").addEventListener("click", async () => { await db.auth.signOut(); location.reload(); });
  $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $$(".nav-item[data-page]").forEach(button => button.addEventListener("click", () => changePage(button.dataset.page)));
  $(".header-brand").addEventListener("click", () => changePage("dashboard"));
  $("#activeDate").addEventListener("change", async event => {
    const date = event.target.value;
    if (!date) return;
    const previous = state.settings.active_date;
    state.settings.active_date = date;
    renderPage();
    const { error } = await db.from("settings").update({ active_date: date, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) { state.settings.active_date = previous; renderPage(); toast(error.message, "error"); }
  });
  $("#modalClose").addEventListener("click", () => closeFormModal());
  $("[data-modal-cancel]").addEventListener("click", () => closeFormModal());
  $("#formModal").addEventListener("click", event => { if (event.target === $("#formModal")) closeFormModal(); });
  $("#modalForm").addEventListener("submit", event => {
    event.preventDefault();
    closeFormModal(Object.fromEntries(new FormData(event.currentTarget).entries()));
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !$("#formModal").classList.contains("hidden")) closeFormModal(); });
  window.addEventListener("unhandledrejection", event => { event.preventDefault(); toast(event.reason?.message || "Proses gagal dijalankan.", "error"); });

  initialize().catch(error => toast(error.message, "error"));
})();
