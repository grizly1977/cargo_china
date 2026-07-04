/* ============================================================
   首次中国采购 — 网站逻辑（中文版）
   ============================================================ */

(function () {
  "use strict";

  var NOT_SPECIFIED = "未提供";

  var STATUS_INFO = {
    "货物已发出": { className: "status-shipped", label: "货物已发出" },
    "计划中": { className: "status-planned", label: "计划中" },
    "准备中": { className: "status-preparing", label: "准备中" }
  };

  var state = {
    cards: [],
    statusFilter: "all",
    searchQuery: ""
  };

  function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function isMissing(value) {
    return (
      value === null ||
      value === undefined ||
      value === "" ||
      value === NOT_SPECIFIED
    );
  }

  function displayValue(value, suffix) {
    if (isMissing(value)) return NOT_SPECIFIED;
    return suffix ? value + suffix : String(value);
  }

  function formatMoney(value, currency) {
    if (value === null || value === undefined || isNaN(value)) return NOT_SPECIFIED;
    var formatted = Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (currency && !isMissing(currency)) {
      return formatted + " " + currency;
    }
    return formatted;
  }

  function formatNumber(value) {
    if (value === null || value === undefined || isNaN(value)) return NOT_SPECIFIED;
    return Number(value).toLocaleString("zh-CN");
  }

  function getStatusInfo(status) {
    return (
      STATUS_INFO[status] || {
        className: "status-unknown",
        label: isMissing(status) ? NOT_SPECIFIED : status
      }
    );
  }

  function basename(path) {
    if (!path) return "";
    var parts = String(path).split("/");
    return parts[parts.length - 1];
  }

  function fileExtension(path) {
    var name = basename(path);
    var idx = name.lastIndexOf(".");
    return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
  }

  var IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp"];

  function isImageFile(path) {
    return IMAGE_EXTENSIONS.indexOf(fileExtension(path)) !== -1;
  }

  /* ---------------- 加载数据 ---------------- */

  function loadData() {
    fetch("data/purchases-zh.json")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        state.cards = Array.isArray(data) ? data : [];
        onDataLoaded();
      })
      .catch(function () {
        state.cards = [];
        onDataLoaded();
      });
  }

  function onDataLoaded() {
    document.getElementById("loadingState").hidden = true;
    renderStats(state.cards);
    applyFiltersAndRender();
  }

  /* ---------------- 统计信息 ---------------- */

  function renderStats(cards) {
    var counts = {
      total: cards.length,
      "货物已发出": 0,
      "计划中": 0,
      "准备中": 0
    };
    cards.forEach(function (card) {
      if (counts.hasOwnProperty(card.status)) {
        counts[card.status]++;
      }
    });
    document.getElementById("statTotal").textContent = counts.total;
    document.getElementById("statShipped").textContent = counts["货物已发出"];
    document.getElementById("statPlanned").textContent = counts["计划中"];
    document.getElementById("statPreparing").textContent = counts["准备中"];
  }

  /* ---------------- 搜索与筛选 ---------------- */

  function cardSearchHaystack(card) {
    var fileNames = []
      .concat(card.photos || [])
      .concat(card.invoiceFiles || [])
      .concat(card.supplierFiles || [])
      .concat(card.extraDocuments || [])
      .map(basename);

    return [
      card.title,
      card.id,
      card.status,
      card.supplierName,
      card.chatName,
      card.wechatId,
      card.size,
      card.userComment,
      card.systemNotes,
      card.additionalContact,
      card.actionRequired
    ]
      .concat(fileNames)
      .filter(function (v) { return !isMissing(v); })
      .join(" ")
      .toLowerCase();
  }

  function applyFiltersAndRender() {
    var query = state.searchQuery.trim().toLowerCase();
    var filtered = state.cards.filter(function (card) {
      if (state.statusFilter !== "all" && card.status !== state.statusFilter) {
        return false;
      }
      if (!query) return true;
      return cardSearchHaystack(card).indexOf(query) !== -1;
    });

    renderCards(filtered);

    var hasNoCardsAtAll = state.cards.length === 0;
    document.getElementById("emptyState").hidden = !hasNoCardsAtAll;
    document.getElementById("noResultsState").hidden = hasNoCardsAtAll || filtered.length > 0;
    document.getElementById("cardsContainer").hidden = hasNoCardsAtAll || filtered.length === 0;
  }

  /* ---------------- 渲染卡片 ---------------- */

  function cardImageHtml(card) {
    if (card.mainImage) {
      return (
        '<img src="' +
        escapeHtml(card.mainImage) +
        '" alt="' +
        escapeHtml(card.title) +
        '" loading="lazy">'
      );
    }
    return '<span class="placeholder-icon">🖼️</span>';
  }

  function renderPaymentNote(card) {
    if (isMissing(card.paymentNote)) return "";
    return '<div class="payment-note">' + escapeHtml(card.paymentNote) + "</div>";
  }

  function renderActionRequired(card) {
    if (isMissing(card.actionRequired)) return "";
    return (
      '<div class="action-required-banner"><span>🛑</span><div><strong>需要您处理</strong><p>' +
      escapeHtml(card.actionRequired) +
      "</p></div></div>"
    );
  }

  function metaRow(label, value) {
    return (
      '<div class="meta-row"><span class="meta-label">' +
      escapeHtml(label) +
      '</span><span class="meta-value">' +
      escapeHtml(value) +
      "</span></div>"
    );
  }

  function renderCard(card) {
    var statusInfo = getStatusInfo(card.status);
    var quantity = card.quantity !== null && card.quantity !== undefined
      ? formatNumber(card.quantity) + " 件"
      : NOT_SPECIFIED;
    var unitPrice = formatMoney(card.unitPrice, card.currency);
    var invoiceTotal = formatMoney(card.invoiceTotal, card.currency);
    var hasWarnings = Array.isArray(card.warnings) && card.warnings.length > 0;

    var html =
      '<article class="purchase-card" data-id="' + escapeHtml(card.id) + '">' +
        '<div class="purchase-card-image">' +
          cardImageHtml(card) +
          (hasWarnings
            ? '<span class="warning-indicator">⚠️ 存在提示信息</span>'
            : "") +
        "</div>" +
        '<div class="purchase-card-body">' +
          '<h3 class="purchase-card-title">' + escapeHtml(displayValue(card.title)) + "</h3>" +
          '<span class="status-badge ' + statusInfo.className + '">' + escapeHtml(statusInfo.label) + "</span>" +
          renderPaymentNote(card) +
          renderActionRequired(card) +
          '<div class="purchase-card-meta">' +
            metaRow("数量", quantity) +
            metaRow("单价", unitPrice) +
            metaRow("发票总额", invoiceTotal) +
            metaRow("尺寸", displayValue(card.size)) +
            metaRow("供应商", displayValue(card.supplierName)) +
            (!isMissing(card.boxDimensions) ? metaRow("箱子尺寸", card.boxDimensions) : "") +
            (card.boxCount !== null && card.boxCount !== undefined ? metaRow("箱数", card.boxCount + " 箱") : "") +
            (card.boxWeight !== null && card.boxWeight !== undefined ? metaRow("箱重", card.boxWeight + " 公斤") : "") +
            (!isMissing(card.chatNote) ? metaRow("聊天记录", card.chatNote) : "") +
          "</div>" +
          '<div class="purchase-card-footer"><span>' + escapeHtml(card.id) + "</span></div>" +
        "</div>" +
      "</article>";

    return html;
  }

  function renderCards(cards) {
    var container = document.getElementById("cardsContainer");
    container.innerHTML = cards.length === 0 ? "" : cards.map(renderCard).join("");
  }

  /* ---------------- 简易 Markdown 渲染器 ---------------- */

  function inlineMarkdown(text) {
    var escaped = escapeHtml(text);
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
    return escaped;
  }

  function renderMiniMarkdown(text) {
    if (isMissing(text)) return '<p class="markdown-block-empty">' + NOT_SPECIFIED + "</p>";

    var lines = String(text).split("\n");
    var html = "";
    var i = 0;

    while (i < lines.length) {
      var line = lines[i].trim();

      if (!line || line === "---") {
        i++;
        continue;
      }

      var headingMatch = line.match(/^(#{1,6})\s*(.+)$/);
      if (headingMatch) {
        html += "<h4>" + inlineMarkdown(headingMatch[2]) + "</h4>";
        i++;
        continue;
      }

      if (line.indexOf("|") === 0) {
        var tableLines = [];
        while (i < lines.length && lines[i].trim().indexOf("|") === 0) {
          tableLines.push(lines[i].trim());
          i++;
        }
        html += renderTable(tableLines);
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
          i++;
        }
        html += "<ul>" + items.map(function (it) {
          return "<li>" + inlineMarkdown(it) + "</li>";
        }).join("") + "</ul>";
        continue;
      }

      var paragraphLines = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() &&
        lines[i].trim() !== "---" &&
        lines[i].trim().indexOf("|") !== 0 &&
        !/^#{1,6}\s/.test(lines[i].trim()) &&
        !/^[-*]\s+/.test(lines[i].trim())
      ) {
        paragraphLines.push(lines[i].trim());
        i++;
      }
      html += "<p>" + inlineMarkdown(paragraphLines.join(" ")) + "</p>";
    }

    return html;
  }

  function renderTable(tableLines) {
    var rows = tableLines
      .map(function (l) {
        return l
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map(function (c) { return c.trim(); });
      })
      .filter(function (cols) {
        return !cols.every(function (c) { return /^:?-+:?$/.test(c); });
      });

    if (rows.length === 0) return "";

    var dataRows = rows;
    // 如果第一行是表头（"字段/数值"、"参数/数值" 等），跳过它——
    // 对于两列表格，表头本身没有额外信息量
    if (rows.length > 1) {
      dataRows = rows.slice(1);
    }

    var maxCols = Math.max.apply(null, dataRows.map(function (r) { return r.length; }));

    if (maxCols <= 2) {
      var html = '<div class="kv-table">';
      dataRows.forEach(function (cols) {
        var label = cols[0] || "";
        var value = cols[1] || "";
        html += '<div class="kv-row"><span class="kv-label">' + inlineMarkdown(label) +
          '</span><span class="kv-value">' + inlineMarkdown(value) + "</span></div>";
      });
      html += "</div>";
      return html;
    }

    var header = rows[0];
    var html2 = '<div class="kv-table">';
    dataRows.forEach(function (cols) {
      var parts = cols.map(function (c, idx) {
        var h = header[idx] ? header[idx] + ": " : "";
        return h + c;
      });
      html2 += '<div class="wide-row">' + inlineMarkdown(parts.join(" · ")) + "</div>";
    });
    html2 += "</div>";
    return html2;
  }

  /* ---------------- 详情页 ---------------- */

  function infoRow(label, value) {
    return (
      '<div class="info-row"><span class="info-label">' +
      escapeHtml(label) +
      '</span><span class="info-value">' +
      escapeHtml(value) +
      "</span></div>"
    );
  }

  function renderGallery(card) {
    if (!card.photos || card.photos.length === 0) {
      return '<div class="detail-gallery-placeholder">🖼️</div>';
    }
    var html = '<div class="detail-gallery">';
    card.photos.forEach(function (src) {
      html += '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(card.title) + '" loading="lazy">';
    });
    html += "</div>";
    return html;
  }

  function docIconFor(path) {
    var ext = fileExtension(path);
    if (ext === "pdf") return "📄";
    if (isImageFile(path)) return "🖼️";
    return "📎";
  }

  function renderDocLinks(title, files) {
    if (!files || files.length === 0) return "";
    var html =
      '<div class="detail-section"><h4 class="detail-section-title">' +
      escapeHtml(title) +
      '</h4><div class="doc-list">';
    files.forEach(function (path) {
      html +=
        '<a class="doc-link" href="' +
        escapeHtml(path) +
        '" target="_blank" rel="noopener noreferrer">' +
        '<span class="doc-icon">' + docIconFor(path) + '</span><span>' +
        escapeHtml(basename(path)) +
        "</span></a>";
    });
    html += "</div></div>";
    return html;
  }

  function renderChatHistory(card) {
    if (isMissing(card.chatHistory) && isMissing(card.chatSummary)) return "";
    var summaryHtml = isMissing(card.chatSummary)
      ? ""
      : '<div class="plain-text-block">' + inlineMarkdown(card.chatSummary) + "</div>";
    var historyHtml = isMissing(card.chatHistory)
      ? ""
      : '<details class="disclosure"><summary>查看与供应商的聊天记录 <span class="disclosure-arrow">▾</span></summary>' +
        '<div class="disclosure-content markdown-block">' + renderMiniMarkdown(card.chatHistory) + "</div>" +
        "</details>";
    return (
      '<div class="detail-section"><h4 class="detail-section-title">与供应商的聊天记录</h4>' +
      summaryHtml + historyHtml +
      "</div>"
    );
  }

  function renderWarnings(card) {
    if (!Array.isArray(card.warnings) || card.warnings.length === 0) return "";
    var items = card.warnings.map(function (w) { return "<li>" + escapeHtml(w) + "</li>"; }).join("");
    return (
      '<div class="warning-banner"><span>⚠️</span><div><strong>存在提示信息</strong><ul>' +
      items +
      "</ul></div></div>"
    );
  }

  function renderDetail(card) {
    var statusInfo = getStatusInfo(card.status);

    var financeRows =
      infoRow("采购单价", formatMoney(card.unitPrice, card.currency)) +
      infoRow("单件包装费用", formatMoney(card.packagingCostPerUnit, card.currency)) +
      infoRow("单件包装袋费用", formatMoney(card.bagCostPerUnit, card.currency)) +
      infoRow("采购总额", formatMoney(card.purchaseTotal, card.currency)) +
      infoRow("发票总额", formatMoney(card.invoiceTotal, card.currency));

    var generalRows =
      infoRow("卡片编号", card.id) +
      infoRow("尺寸", displayValue(card.size)) +
      infoRow("数量", card.quantity !== null && card.quantity !== undefined ? formatNumber(card.quantity) + " 件" : NOT_SPECIFIED) +
      infoRow("单件重量", card.unitWeight !== null && card.unitWeight !== undefined ? formatNumber(card.unitWeight) + " 公斤" : NOT_SPECIFIED) +
      infoRow("单件尺寸", displayValue(card.unitDimensions)) +
      infoRow("单件 CBM", card.unitCbm !== null && card.unitCbm !== undefined ? card.unitCbm + " CBM" : NOT_SPECIFIED);

    var supplierRows =
      infoRow("聊天备注名", displayValue(card.chatName)) +
      infoRow("供应商", displayValue(card.supplierName)) +
      infoRow("微信号", displayValue(card.wechatId)) +
      infoRow("其他联系方式", displayValue(card.additionalContact));

    var documentsHtml =
      renderDocLinks("发票照片", card.invoiceFiles) +
      renderDocLinks("供应商 / 聊天截图", card.supplierFiles) +
      renderDocLinks("其他文件", card.extraDocuments);

    var html =
      '<div class="detail-header">' +
        '<button class="detail-close-btn" id="detailCloseBtn" aria-label="关闭">✕</button>' +
        '<span class="detail-header-title">' + escapeHtml(card.id) + "</span>" +
        '<span style="width:44px"></span>' +
      "</div>" +
      '<div class="detail-body">' +
        renderGallery(card) +
        '<div class="detail-title-row">' +
          '<h2 class="detail-title">' + escapeHtml(displayValue(card.title)) + "</h2>" +
          '<span class="status-badge ' + statusInfo.className + '">' + escapeHtml(statusInfo.label) + "</span>" +
        "</div>" +
        renderPaymentNote(card) +
        renderActionRequired(card) +
        '<p class="detail-card-id">' + escapeHtml(card.id) + " · " + escapeHtml(card.date || "") +
          (card.location ? " · " + escapeHtml(card.location) : "") + "</p>" +
        renderWarnings(card) +
        '<div class="detail-section"><h4 class="detail-section-title">基本信息</h4><div class="info-grid">' + generalRows + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">财务核算</h4><div class="info-grid">' + financeRows + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">供应商信息</h4><div class="info-grid">' + supplierRows + "</div></div>" +
        documentsHtml +
        '<div class="detail-section"><h4 class="detail-section-title">海运 + UPS 打包方案</h4><div class="markdown-block">' + renderMiniMarkdown(card.packagingSeaUps) + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">海运 + 卡车打包方案</h4><div class="markdown-block">' + renderMiniMarkdown(card.packagingSeaTruck) + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">用户备注</h4><div class="plain-text-block">' + inlineMarkdown(displayValue(card.userComment)) + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">系统备注</h4><div class="markdown-block">' + renderMiniMarkdown(card.systemNotes) + "</div></div>" +
        renderChatHistory(card) +
        '<details class="disclosure"><summary>查看原始 MD 卡片 <span class="disclosure-arrow">▾</span></summary>' +
          '<div class="disclosure-content markdown-block">' + renderMiniMarkdown(card.rawMarkdown) + "</div>" +
        "</details>" +
      "</div>";

    return html;
  }

  function openDetail(cardId) {
    var card = state.cards.filter(function (c) { return c.id === cardId; })[0];
    if (!card) return;
    document.getElementById("detailView").innerHTML = renderDetail(card);
    document.getElementById("detailOverlay").hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeDetail() {
    document.getElementById("detailOverlay").hidden = true;
    document.body.style.overflow = "";
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    document.getElementById("searchInput").addEventListener("input", function (e) {
      state.searchQuery = e.target.value;
      applyFiltersAndRender();
    });

    document.getElementById("filterChips").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      document.querySelectorAll(".chip").forEach(function (c) {
        c.classList.remove("chip-active");
      });
      chip.classList.add("chip-active");
      state.statusFilter = chip.dataset.status;
      applyFiltersAndRender();
    });

    document.getElementById("cardsContainer").addEventListener("click", function (e) {
      var card = e.target.closest(".purchase-card");
      if (!card) return;
      openDetail(card.dataset.id);
    });

    var overlay = document.getElementById("detailOverlay");
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeDetail();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target.closest("#detailCloseBtn")) closeDetail();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeDetail();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindEvents();
    loadData();
  });
})();
