/* ============================================================
   Первая закупка в Китае — логика сайта
   ============================================================ */

(function () {
  "use strict";

  var NOT_SPECIFIED = "не указано";

  var STATUS_INFO = {
    "товар отправлен": { className: "status-shipped", label: "Товар отправлен" },
    "планируется": { className: "status-planned", label: "Планируется" },
    "подготавливается": { className: "status-preparing", label: "Подготавливается" }
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
    var formatted = Number(value).toLocaleString("ru-RU", {
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
    return Number(value).toLocaleString("ru-RU");
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

  /* ---------------- Загрузка данных ---------------- */

  function loadData() {
    fetch("data/purchases.json")
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

  /* ---------------- Статистика ---------------- */

  function renderStats(cards) {
    var counts = {
      total: cards.length,
      "товар отправлен": 0,
      "планируется": 0,
      "подготавливается": 0
    };
    cards.forEach(function (card) {
      if (counts.hasOwnProperty(card.status)) {
        counts[card.status]++;
      }
    });
    document.getElementById("statTotal").textContent = counts.total;
    document.getElementById("statShipped").textContent = counts["товар отправлен"];
    document.getElementById("statPlanned").textContent = counts["планируется"];
    document.getElementById("statPreparing").textContent = counts["подготавливается"];
  }

  /* ---------------- Поиск и фильтрация ---------------- */

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

  /* ---------------- Рендер карточек ---------------- */

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
      '<div class="action-required-banner"><span>🛑</span><div><strong>Требуется ваше действие</strong><p>' +
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
      ? formatNumber(card.quantity) + " шт"
      : NOT_SPECIFIED;
    var unitPrice = formatMoney(card.unitPrice, card.currency);
    var invoiceTotal = formatMoney(card.invoiceTotal, card.currency);
    var hasWarnings = Array.isArray(card.warnings) && card.warnings.length > 0;

    var html =
      '<article class="purchase-card" data-id="' + escapeHtml(card.id) + '">' +
        '<div class="purchase-card-image">' +
          cardImageHtml(card) +
          (hasWarnings
            ? '<span class="warning-indicator">⚠️ Есть предупреждения</span>'
            : "") +
        "</div>" +
        '<div class="purchase-card-body">' +
          '<h3 class="purchase-card-title">' + escapeHtml(displayValue(card.title)) + "</h3>" +
          '<span class="status-badge ' + statusInfo.className + '">' + escapeHtml(statusInfo.label) + "</span>" +
          renderPaymentNote(card) +
          renderActionRequired(card) +
          '<div class="purchase-card-meta">' +
            metaRow("Количество", quantity) +
            metaRow("Цена за шт.", unitPrice) +
            metaRow("Сумма инвойса", invoiceTotal) +
            metaRow("Размер", displayValue(card.size)) +
            metaRow("Поставщик", displayValue(card.supplierName)) +
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

  /* ---------------- Мини-рендерер Markdown ---------------- */

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
    // если первая строка похожа на заголовок таблицы (Поле/Значение, Параметр/Значение и т.п.) — пропустим её,
    // так как для двухколоночных таблиц заголовок неинформативен
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

  /* ---------------- Детальный экран ---------------- */

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

  function renderWarnings(card) {
    if (!Array.isArray(card.warnings) || card.warnings.length === 0) return "";
    var items = card.warnings.map(function (w) { return "<li>" + escapeHtml(w) + "</li>"; }).join("");
    return (
      '<div class="warning-banner"><span>⚠️</span><div><strong>Есть предупреждения</strong><ul>' +
      items +
      "</ul></div></div>"
    );
  }

  function renderDetail(card) {
    var statusInfo = getStatusInfo(card.status);

    var financeRows =
      infoRow("Цена закупки за ед.", formatMoney(card.unitPrice, card.currency)) +
      infoRow("Стоимость упаковки за ед.", formatMoney(card.packagingCostPerUnit, card.currency)) +
      infoRow("Стоимость товарной сумки за ед.", formatMoney(card.bagCostPerUnit, card.currency)) +
      infoRow("Стоимость закупки", formatMoney(card.purchaseTotal, card.currency)) +
      infoRow("Общая стоимость инвойса", formatMoney(card.invoiceTotal, card.currency));

    var generalRows =
      infoRow("Номер карточки", card.id) +
      infoRow("Размер", displayValue(card.size)) +
      infoRow("Количество", card.quantity !== null && card.quantity !== undefined ? formatNumber(card.quantity) + " шт" : NOT_SPECIFIED) +
      infoRow("Вес единицы товара", card.unitWeight !== null && card.unitWeight !== undefined ? formatNumber(card.unitWeight) + " кг" : NOT_SPECIFIED) +
      infoRow("Габариты единицы товара", displayValue(card.unitDimensions)) +
      infoRow("CBM единицы товара", card.unitCbm !== null && card.unitCbm !== undefined ? card.unitCbm + " CBM" : NOT_SPECIFIED);

    var supplierRows =
      infoRow("Имя чата", displayValue(card.chatName)) +
      infoRow("Поставщик", displayValue(card.supplierName)) +
      infoRow("WeChat ID", displayValue(card.wechatId)) +
      infoRow("Доп. контакты", displayValue(card.additionalContact));

    var documentsHtml =
      renderDocLinks("Фото инвойса", card.invoiceFiles) +
      renderDocLinks("Фото поставщика / чата", card.supplierFiles) +
      renderDocLinks("Дополнительные документы", card.extraDocuments);

    var html =
      '<div class="detail-header">' +
        '<button class="detail-close-btn" id="detailCloseBtn" aria-label="Закрыть">✕</button>' +
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
        '<div class="detail-section"><h4 class="detail-section-title">Основная информация</h4><div class="info-grid">' + generalRows + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">Финансовый расчёт</h4><div class="info-grid">' + financeRows + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">Поставщик</h4><div class="info-grid">' + supplierRows + "</div></div>" +
        documentsHtml +
        '<div class="detail-section"><h4 class="detail-section-title">Упаковка море + UPS</h4><div class="markdown-block">' + renderMiniMarkdown(card.packagingSeaUps) + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">Упаковка море + трак</h4><div class="markdown-block">' + renderMiniMarkdown(card.packagingSeaTruck) + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">Комментарий пользователя</h4><div class="plain-text-block">' + inlineMarkdown(displayValue(card.userComment)) + "</div></div>" +
        '<div class="detail-section"><h4 class="detail-section-title">Системные замечания</h4><div class="markdown-block">' + renderMiniMarkdown(card.systemNotes) + "</div></div>" +
        '<details class="disclosure"><summary>Показать оригинальную MD карточку <span class="disclosure-arrow">▾</span></summary>' +
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

  /* ---------------- Обработчики событий ---------------- */

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
