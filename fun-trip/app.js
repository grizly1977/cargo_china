/* Shanghai Disneyland — Rain & Height Fear Guide
   Вся логика: фильтры, карточки, bottom sheet, конструктор маршрута,
   рендер блоков еды/шоу/DPA. Чистый JS, без зависимостей. */

const pinnedRides = new Set();
let toastTimer = null;

/* ===== Плейсхолдер-изображения (SVG data URI, без хотлинка реальных фото) ===== */
function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function svgPlaceholder(ride, label) {
  const colors = ZONE_COLORS[ride.zone] || ["#7c4dff", "#ff6ec7"];
  const gid = "g" + Math.random().toString(36).slice(2, 9);
  const title = escapeXml(label || ride.name);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' +
    '<defs><linearGradient id="' + gid + '" x1="0%" y1="0%" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="' + colors[0] + '"/>' +
    '<stop offset="100%" stop-color="' + colors[1] + '"/>' +
    "</linearGradient></defs>" +
    '<rect width="600" height="400" fill="url(#' + gid + ')"/>' +
    '<circle cx="80" cy="320" r="120" fill="#ffffff" opacity="0.06"/>' +
    '<circle cx="540" cy="60" r="90" fill="#ffffff" opacity="0.06"/>' +
    '<text x="50%" y="44%" font-size="28" font-family="Arial, sans-serif" font-weight="700" fill="#ffffff" text-anchor="middle" opacity="0.95">' + title + "</text>" +
    '<text x="50%" y="56%" font-size="15" font-family="Arial, sans-serif" fill="#ffffffcc" text-anchor="middle">📸 Фото нужно проверить</text>' +
    "</svg>";
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

/* ===== Хелперы рейтингов ===== */
function bucketClass(value) {
  if (value <= 3) return "green";
  if (value <= 6) return "yellow";
  if (value <= 8) return "orange";
  return "red";
}

function gaugeHTML(label, value) {
  const cls = bucketClass(value);
  return (
    '<div class="gauge"><div class="gauge-label">' + label + '</div>' +
    '<div class="gauge-bar"><div class="gauge-fill g-' + cls + '" style="width:' + value * 10 + '%"></div></div>' +
    '<div class="gauge-value v-' + cls + '">' + value + "/10</div></div>"
  );
}

function rainLabel(status) {
  if (status === "yes") return "☔ Да";
  if (status === "partial") return "☔ Частично";
  return "☔ Нет";
}

function rideById(id) {
  return RIDES.find(function (r) { return r.id === id; });
}

/* ===== Фильтры ===== */
function populateZoneFilter() {
  const row = document.querySelector('.chip-row[data-filter-group="zone"]');
  row.innerHTML = ZONE_ORDER.map(function (z) {
    return '<button class="chip" data-value="' + z + '">' + z + "</button>";
  }).join("");
}

function getActiveValues(group) {
  return Array.from(document.querySelectorAll('.chip-row[data-filter-group="' + group + '"] .chip.active')).map(
    function (c) { return c.dataset.value; }
  );
}

function inRange(value, rangeStr) {
  const parts = rangeStr.split("-").map(Number);
  return value >= parts[0] && value <= parts[1];
}

function getSearchQuery() {
  return document.getElementById("ride-search").value.trim().toLowerCase();
}

function passesFilters(ride) {
  const query = getSearchQuery();
  if (query && ride.name.toLowerCase().indexOf(query) === -1 && ride.chineseName.indexOf(query) === -1) return false;

  const rain = getActiveValues("rain");
  if (rain.length && rain.indexOf(ride.rainStatus) === -1) return false;

  const hf = getActiveValues("heightFear");
  if (hf.length && !hf.some(function (range) { return inRange(ride.heightFear, range); })) return false;

  const verdict = getActiveValues("verdict");
  if (verdict.length && verdict.indexOf(ride.acrophobiaVerdict) === -1) return false;

  const zone = getActiveValues("zone");
  if (zone.length && zone.indexOf(ride.zone) === -1) return false;

  const wait = getActiveValues("wait");
  if (wait.length && !wait.some(function (range) { return inRange(ride.avgWaitMin, range); })) return false;

  const type = getActiveValues("type");
  if (type.length && !type.some(function (t) { return ride.tags.indexOf(t) !== -1; })) return false;

  return true;
}

/* ===== Карточки ===== */
function cardHTML(ride) {
  const isPinned = pinnedRides.has(ride.id);
  return (
    '<div class="ride-card" data-id="' + ride.id + '">' +
      '<img class="ride-card-img" src="' + svgPlaceholder(ride) + '" alt="' + escapeXml(ride.name) + '">' +
      '<span class="ride-card-zone-badge">' + ride.zone + "</span>" +
      '<span class="ride-card-rain-badge rain-' + ride.rainStatus + '">' + rainLabel(ride.rainStatus) + "</span>" +
      '<div class="ride-card-body">' +
        '<h3 class="ride-card-title">' + ride.name + "</h3>" +
        '<p class="ride-card-chinese">' + ride.chineseName + "</p>" +
        '<div class="ride-card-meta">' +
          "<span>⏱ " + ride.durationMin + " мин</span>" +
          "<span>🕒 очередь ~" + ride.avgWaitMin + " мин</span>" +
          "<span>" + ride.type + "</span>" +
        "</div>" +
        '<div class="gauge-row">' + gaugeHTML("Высота", ride.heightFear) + gaugeHTML("Экстрим", ride.thrill) + "</div>" +
        '<span class="verdict-tag verdict-' + ride.recommendation + '">' + ride.acrophobiaVerdict + "</span>" +
        '<p class="ride-card-why">' + ride.whyScaryOrSafe + "</p>" +
        '<div class="ride-card-actions">' +
          '<button class="btn-detail" data-id="' + ride.id + '">Подробнее</button>' +
          '<button class="btn-add ' + (isPinned ? "added" : "") + '" data-id="' + ride.id + '">' +
            (isPinned ? "✓ В маршруте" : "+ В маршрут") +
          "</button>" +
        "</div>" +
      "</div>" +
    "</div>"
  );
}

function renderCards() {
  const filtered = RIDES.filter(passesFilters);
  const grid = document.getElementById("cards-grid");
  grid.innerHTML = filtered.map(cardHTML).join("");
  document.getElementById("results-counter").textContent = "Показано " + filtered.length + " из " + RIDES.length;
  document.getElementById("empty-state").hidden = filtered.length !== 0;
}

/* ===== Bottom sheet ===== */
function flagLabel(key) {
  return {
    hangingLegs: "Свисающие ноги",
    openCabin: "Открытая кабина",
    visualHeight: "Видна высота",
    fall: "Ощущение падения",
    darkness: "Темнота",
    rotation: "Вращение"
  }[key];
}

function flagsHTML(flags) {
  return Object.keys(flags).map(function (key) {
    const yes = flags[key];
    return (
      '<div class="flag-item ' + (yes ? "flag-yes" : "flag-no") + '">' +
      (yes ? "⚠️ " : "✅ ") + flagLabel(key) +
      "</div>"
    );
  }).join("");
}

function sheetHTML(ride) {
  const swiper = ride.images.map(function (imgId, i) {
    return '<img src="' + svgPlaceholder(ride, ride.name + " — фото " + (i + 1)) + '" alt="' + escapeXml(ride.name) + '">';
  }).join("");

  return (
    '<div class="sheet-swiper">' + swiper + "</div>" +
    '<h2 class="sheet-title">' + ride.name + "</h2>" +
    '<p class="sheet-chinese">' + ride.chineseName + " • " + ride.zone + "</p>" +
    '<span class="verdict-tag verdict-' + ride.recommendation + '">' + ride.acrophobiaVerdict + "</span>" +
    '<p class="sheet-text">' + ride.description + "</p>" +
    '<h3 class="sheet-section-title">Почему страшно или безопасно</h3>' +
    '<p class="sheet-text">' + ride.whyScaryOrSafe + "</p>" +
    '<h3 class="sheet-section-title">Триггеры высоты</h3>' +
    '<div class="flag-grid">' + flagsHTML(ride.flags) + "</div>" +
    '<h3 class="sheet-section-title">Очередь по времени</h3>' +
    '<table class="wait-table">' +
      "<tr><td>Среднее (будни)</td><td>" + ride.avgWaitMin + " мин</td></tr>" +
      "<tr><td>Выходные</td><td>" + ride.weekendWaitMin + " мин</td></tr>" +
      "<tr><td>Праздники</td><td>" + ride.holidayWaitMin + " мин</td></tr>" +
      "<tr><td>Утро</td><td>" + ride.morningWaitMin + " мин</td></tr>" +
      "<tr><td>Вечер</td><td>" + ride.eveningWaitMin + " мин</td></tr>" +
    "</table>" +
    '<h3 class="sheet-section-title">Дождь</h3>' +
    '<p class="sheet-text"><span class="ride-card-rain-badge rain-' + ride.rainStatus + '" style="position:static;display:inline-block;margin-bottom:8px;">' +
      rainLabel(ride.rainStatus) + "</span><br>" + ride.rainNotes + "</p>" +
    '<button class="sheet-close-btn" id="sheet-close">Закрыть</button>'
  );
}

function openSheet(ride) {
  document.getElementById("sheet-content").innerHTML = sheetHTML(ride);
  document.getElementById("sheet-overlay").classList.add("open");
  const closeBtn = document.getElementById("sheet-close");
  if (closeBtn) closeBtn.addEventListener("click", closeSheet);
}

function closeSheet() {
  document.getElementById("sheet-overlay").classList.remove("open");
}

/* ===== Toast ===== */
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
}

/* ===== Pin / маршрут счётчик ===== */
function updatePinCount() {
  const el = document.getElementById("route-pin-count");
  el.textContent = pinnedRides.size ? "(" + pinnedRides.size + ")" : "";
}

/* ===== Дождевые списки ===== */
function renderRainLists() {
  const go = RIDES.filter(function (r) { return r.rainStatus === "yes" && r.recommendation !== "skip"; })
    .sort(function (a, b) { return rideScore(b) - rideScore(a); });
  const skip = RIDES.filter(function (r) { return r.rainStatus === "no"; });

  document.getElementById("rain-go-list").innerHTML = go.map(function (r) {
    return "<li>" + r.name + " (" + r.zone + ") — " + r.rainNotes + "</li>";
  }).join("");

  document.getElementById("rain-skip-list").innerHTML = skip.map(function (r) {
    return "<li>" + r.name + " (" + r.zone + ") — " + r.rainNotes + "</li>";
  }).join("");
}

/* ===== Еда ===== */
function renderFood() {
  document.getElementById("food-grid").innerHTML = RESTAURANTS.map(function (r) {
    return (
      '<div class="food-card">' +
        "<h3>" + r.name + "</h3>" +
        '<p class="food-zone">' + r.zone + "</p>" +
        '<p class="food-row">🍴 ' + r.whatToOrder + "</p>" +
        '<p class="food-row">🕒 ' + r.bestTime + "</p>" +
        '<p class="food-row">' + r.why + "</p>" +
        '<div class="food-tags">' +
          '<span class="food-tag ' + (r.rainFriendly ? "yes" : "") + '">' + (r.rainFriendly ? "☔ Спасает от дождя" : "☀ Только в сухую") + "</span>" +
          '<span class="food-tag ' + (r.longStay ? "yes" : "") + '">' + (r.longStay ? "🪑 Можно отдыхать долго" : "⚡ Быстрая остановка") + "</span>" +
        "</div>" +
      "</div>"
    );
  }).join("");
}

/* ===== Вечернее шоу ===== */
function renderShow() {
  document.getElementById("show-content").innerHTML =
    '<div class="show-card">' +
      "<strong>" + EVENING_SHOW.name + "</strong><br>" +
      "📍 " + EVENING_SHOW.where + "<br>" +
      "⏰ Займите место за " + EVENING_SHOW.claimSpotMin + " мин до начала<br>" +
      "☔ " + EVENING_SHOW.rainPolicy + "<br>" +
      "🏠 Если шоу отменят из-за дождя, загляните на: " + EVENING_SHOW.backupIndoor.join(", ") +
    "</div>" +
    '<div class="disclaimer-box">⚠️ ' + EVENING_SHOW.disclaimer + "</div>";
}

/* ===== DPA ===== */
function dpaListHTML(items) {
  return items.map(function (item) {
    return "<li>🎫 <strong>" + (rideById(item.id) ? rideById(item.id).name : item.id) + "</strong> — " + item.note + "</li>";
  }).join("");
}

function renderDpa() {
  document.getElementById("dpa-content").innerHTML =
    '<div class="dpa-card">' + DPA_INFO.intro + "<br><br>" + DPA_INFO.priceNote + "</div>" +
    '<h3 class="sub-title">Берите DPA в первую очередь</h3>' +
    '<ul class="dpa-list">' + dpaListHTML(DPA_INFO.highPriority) + "</ul>" +
    '<h3 class="sub-title">Зависит от погоды</h3>' +
    '<ul class="dpa-list">' + dpaListHTML(DPA_INFO.weatherDependent) + "</ul>" +
    '<h3 class="sub-title">Низкий приоритет</h3>' +
    '<ul class="dpa-list">' + dpaListHTML(DPA_INFO.lowPriority) + "</ul>" +
    '<div class="dpa-card">' + DPA_INFO.notNeeded + "</div>" +
    '<div class="dpa-card">☔ ' + DPA_INFO.rainAdvice + "</div>";
}

/* ===== Конструктор маршрута ===== */
const PRIORITY_WEIGHT = { "Максимальный": 4, "Очень высокий": 3.5, "Высокий": 3, "Средний": 2, "Низкий": 1 };

function verdictBonus(v) {
  if (v === "Обязательно посетить") return 1;
  if (v === "Скорее посетить") return 0.5;
  return 0;
}

function rideScore(r) {
  return (PRIORITY_WEIGHT[r.priority] || 1) * 10 + verdictBonus(r.acrophobiaVerdict) * 5 - r.avgWaitMin * 0.05;
}

function transitionTime(zoneA, zoneB) {
  if (!zoneA) return 5;
  if (zoneA === zoneB) return 3;
  const dist = Math.abs(ZONE_ORDER.indexOf(zoneA) - ZONE_ORDER.indexOf(zoneB));
  return Math.min(15, 8 + dist * 1.5);
}

function buildRoute(hours, rainMode, acrophobiaMode) {
  const budget = hours * 60;
  let pool = RIDES.filter(function (r) {
    if (r.heightFear >= 9) return false;
    if (acrophobiaMode && r.heightFear >= 7) return false;
    if (rainMode && r.rainStatus === "no") return false;
    return true;
  });
  pool = pool.slice().sort(function (a, b) { return rideScore(b) - rideScore(a); });

  const selected = [];
  let elapsed = 0;
  let currentZone = null;

  pool.forEach(function (r) {
    const wait = rainMode ? r.avgWaitMin * 0.7 : r.avgWaitMin;
    const trans = transitionTime(currentZone, r.zone);
    const cost = r.durationMin + wait + trans;
    if (elapsed + cost <= budget) {
      selected.push({ ride: r, wait: wait, trans: trans, cost: cost });
      elapsed += cost;
      currentZone = r.zone;
    }
  });

  selected.sort(function (a, b) { return ZONE_ORDER.indexOf(a.ride.zone) - ZONE_ORDER.indexOf(b.ride.zone); });

  return { selected: selected, elapsed: elapsed, budget: budget };
}

function formatTime(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h + ":" + String(m).padStart(2, "0");
}

function pickNearestRestaurant(zone) {
  const direct = RESTAURANTS.find(function (r) { return r.zone.indexOf(zone) !== -1; });
  return direct || RESTAURANTS[0];
}

function getSelectedHours() {
  const custom = parseFloat(document.getElementById("custom-hours").value);
  if (!isNaN(custom) && custom > 0) return custom;
  const active = document.querySelector("#hours-row .chip.active");
  if (active) return parseFloat(active.dataset.hours);
  return 5;
}

function renderRoute() {
  const hours = getSelectedHours();
  const rainMode = document.getElementById("toggle-rain").checked;
  const acrophobiaMode = document.getElementById("toggle-acrophobia").checked;
  const result = buildRoute(hours, rainMode, acrophobiaMode);
  const selected = result.selected;

  if (selected.length === 0) {
    document.getElementById("route-result").innerHTML =
      '<div class="route-result-summary">Не получилось подобрать маршрут на это время с такими условиями — попробуйте увеличить часы или снять часть фильтров.</div>';
    return;
  }

  let html =
    '<div class="route-result-summary">✨ За ' + hours + " ч получится посмотреть <strong>" + selected.length + "</strong> аттракцион(ов)" +
    (rainMode ? " с учётом дождя" : "") + (acrophobiaMode ? " и страха высоты" : "") + ".</div>" +
    '<ol class="route-timeline">';

  const mealIndex = hours >= 4 ? Math.floor(selected.length / 2) : -1;
  let running = 0;

  selected.forEach(function (item, i) {
    html +=
      "<li><span class=\"route-time\">" + formatTime(running) + "</span><div>" +
      '<div class="route-item-title">' + item.ride.name + "</div>" +
      '<div class="route-item-sub">' + item.ride.zone + " • очередь ~" + Math.round(item.wait) + " мин • " + item.ride.durationMin + " мин аттракцион</div>" +
      "</div></li>";
    running += item.cost;

    if (i === mealIndex) {
      const meal = pickNearestRestaurant(item.ride.zone);
      html +=
        '<li class="route-break"><span class="route-time">' + formatTime(running) + "</span><div>" +
        '<div class="route-item-title">🍽️ Перерыв на еду — ' + meal.name + "</div>" +
        '<div class="route-item-sub">' + meal.zone + " • " + meal.why + "</div>" +
        "</div></li>";
      running += 45;
    }
  });

  if (hours >= 5) {
    html +=
      '<li class="route-show"><span class="route-time">' + formatTime(running) + "</span><div>" +
      '<div class="route-item-title">🎆 ' + EVENING_SHOW.name + "</div>" +
      '<div class="route-item-sub">Займите место за ' + EVENING_SHOW.claimSpotMin + " мин у " + EVENING_SHOW.where + "</div>" +
      "</div></li>";
  }

  html += "</ol>";
  document.getElementById("route-result").innerHTML = html;
}

/* ===== Скролл ===== */
function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const nav = document.getElementById("sticky-nav");
  const navHeight = nav ? nav.offsetHeight : 0;
  const top = el.getBoundingClientRect().top + window.pageYOffset - navHeight - 8;
  window.scrollTo({ top: top, behavior: "smooth" });
}

/* ===== Инициализация и обработчики ===== */
populateZoneFilter();
renderCards();
renderRainLists();
renderFood();
renderShow();
renderDpa();

const defaultHoursChip = document.querySelector('#hours-row .chip[data-hours="5"]');
if (defaultHoursChip) defaultHoursChip.classList.add("active");

document.getElementById("filters-panel").addEventListener("click", function (e) {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  chip.classList.toggle("active");
  renderCards();
});

document.getElementById("reset-filters").addEventListener("click", function () {
  document.querySelectorAll("#filters-panel .chip.active").forEach(function (c) { c.classList.remove("active"); });
  document.getElementById("ride-search").value = "";
  document.getElementById("search-clear").hidden = true;
  renderCards();
});

document.getElementById("ride-search").addEventListener("input", function () {
  document.getElementById("search-clear").hidden = !this.value;
  renderCards();
});

document.getElementById("search-clear").addEventListener("click", function () {
  const input = document.getElementById("ride-search");
  input.value = "";
  this.hidden = true;
  input.focus();
  renderCards();
});

document.getElementById("cards-grid").addEventListener("click", function (e) {
  const detailBtn = e.target.closest(".btn-detail");
  const addBtn = e.target.closest(".btn-add");

  if (detailBtn) {
    const ride = rideById(detailBtn.dataset.id);
    if (ride) openSheet(ride);
    return;
  }

  if (addBtn) {
    const id = addBtn.dataset.id;
    if (pinnedRides.has(id)) {
      pinnedRides.delete(id);
      addBtn.classList.remove("added");
      addBtn.textContent = "+ В маршрут";
      showToast("Убрано из маршрута");
    } else {
      pinnedRides.add(id);
      addBtn.classList.add("added");
      addBtn.textContent = "✓ В маршруте";
      showToast("Добавлено в маршрут");
    }
    updatePinCount();
  }
});

document.getElementById("sheet-overlay").addEventListener("click", function (e) {
  if (e.target.id === "sheet-overlay") closeSheet();
});

document.getElementById("hours-row").addEventListener("click", function (e) {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll("#hours-row .chip").forEach(function (c) { c.classList.remove("active"); });
  chip.classList.add("active");
  document.getElementById("custom-hours").value = "";
});

document.getElementById("custom-hours").addEventListener("input", function () {
  if (document.getElementById("custom-hours").value) {
    document.querySelectorAll("#hours-row .chip").forEach(function (c) { c.classList.remove("active"); });
  }
});

document.getElementById("build-route-btn").addEventListener("click", renderRoute);
document.getElementById("sticky-build-route").addEventListener("click", function () { scrollToId("route-builder"); });

document.querySelectorAll("[data-scroll-to]").forEach(function (btn) {
  btn.addEventListener("click", function () { scrollToId(btn.dataset.scrollTo); });
});
