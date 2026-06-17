let DATA = null;
let currentSort = "score";

const fmtUsd = (v) => "$" + Number(v).toFixed(2).replace(/\.00$/, "");

const DDP_LABELS = {
  confirmed: { text: "DDP подтверждён", cls: "badge-green" },
  partial: { text: "DDP частично", cls: "badge-yellow" },
  unclear: { text: "Нужно уточнить", cls: "badge-red" },
};

const PICKUP_LABELS = {
  included: { text: "Включён", cls: "badge-green" },
  paid: { text: "Платный", cls: "badge-yellow" },
  not_available: { text: "Не организован", cls: "badge-red" },
  unknown: { text: "Нужно уточнить", cls: "badge-gray" },
};

const INCLUDED_LABELS = {
  sea: "Море", truck: "Грузовик", customs: "Таможня", duties: "Пошлины",
  taxes: "Налоги", door: "До двери", warehouse_handling: "Склад", pickup: "Пикап",
};

function ddpBadge(status) {
  const l = DDP_LABELS[status] || DDP_LABELS.unclear;
  return `<span class="badge ${l.cls}">${l.text}</span>`;
}

function pickupBadge(status) {
  const l = PICKUP_LABELS[status] || PICKUP_LABELS.unknown;
  return `<span class="badge ${l.cls}">${l.text}</span>`;
}

function includedList(inc) {
  return `<div class="included-list">${Object.entries(inc).map(([k, v]) =>
    `<span class="inc-tag ${v ? "" : "off"}">${INCLUDED_LABELS[k] || k}</span>`
  ).join("")}</div>`;
}

async function init() {
  const res = await fetch("data.json");
  DATA = await res.json();
  renderHeader();
  renderSummaryCards();
  renderTop5();
  renderTable();
  renderDetailCards();
  renderIncomplete();
  renderMethodology();
  bindControls();
}

function renderHeader() {
  const m = DATA.meta;
  document.getElementById("header-stats").textContent =
    `Дата формирования: ${m.generated_at} · Проанализировано чатов: ${m.total_chats_analyzed} · ` +
    `Компаний с полными данными: ${m.complete_companies} · С неполными данными: ${m.incomplete_companies} · ` +
    `Груз: ${m.cargo_summary.product}, ${m.cargo_summary.gross_weight_kg} кг, ${m.cargo_summary.origin} → ${m.cargo_summary.destination}`;
}

function renderSummaryCards() {
  const list = DATA.complete;
  const cheapest = [...list].sort((a, b) => a.final_total_usd - b.final_total_usd)[0];
  const bestOverall = [...list].sort((a, b) => b.score.total - a.score.total)[0];
  const withTransit = list.filter(c => c.score.transit > 0);
  const fastest = withTransit.length ? [...withTransit].sort((a, b) => b.score.transit - a.score.transit)[0] : null;
  const bestPickup = [...list].sort((a, b) => b.score.pickup - a.score.pickup)[0];
  const avgPerKg = list.reduce((s, c) => s + c.price_per_kg_usd, 0) / list.length;
  const minPrice = Math.min(...list.map(c => c.final_total_usd));
  const maxPrice = Math.max(...list.map(c => c.final_total_usd));

  const cards = [
    { label: "Самая дешёвая компания", value: cheapest.company, sub: `${fmtUsd(cheapest.final_total_usd)} итого` },
    { label: "Лучший общий вариант (score)", value: bestOverall.company, sub: `Score: ${bestOverall.score.total}` },
    { label: "Самая быстрая доставка", value: fastest ? fastest.company : "Не указано", sub: fastest ? fastest.transit_time : "" },
    { label: "Лучший вариант пикапа из Nantong", value: bestPickup.company, sub: PICKUP_LABELS[bestPickup.pickup_from_nantong]?.text || "" },
    { label: "Средняя цена за кг", value: "$" + avgPerKg.toFixed(2), sub: "по всем полным компаниям" },
    { label: "Диапазон итоговых цен", value: `${fmtUsd(minPrice)} – ${fmtUsd(maxPrice)}`, sub: "USD, DDP сравнимые предложения" },
  ];

  document.getElementById("summary-cards").innerHTML = cards.map(c =>
    `<div class="summary-card"><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`
  ).join("");
}

function renderTop5() {
  const top5 = [...DATA.complete].sort((a, b) => a.rank - b.rank).slice(0, 5);
  document.getElementById("top5").innerHTML = top5.map(c => `
    <div class="top5-card">
      <div class="rank">${c.rank}</div>
      <h3>${c.company}</h3>
      <div class="price">${fmtUsd(c.final_total_usd)}</div>
      <div class="meta-line">${c.price_per_kg_usd} $/кг · ${c.transit_time}</div>
      <div class="meta-line">${pickupBadge(c.pickup_from_nantong)} ${ddpBadge(c.ddp_status)}</div>
      <div class="meta-line">Score: <strong>${c.score.total}</strong></div>
      <div class="rationale">${topRationale(c)}</div>
    </div>
  `).join("");
}

function topRationale(c) {
  const parts = [];
  if (c.score.price >= 40) parts.push("одна из самых низких цен");
  if (c.pickup_from_nantong === "included") parts.push("пикап из Nantong включён в цену");
  if (c.ddp_status === "confirmed") parts.push("DDP чётко подтверждён");
  if (c.score.transit >= 12) parts.push("относительно быстрый срок доставки");
  if (!parts.length) parts.push("сбалансированное сочетание цены, срока и условий");
  return parts.join(", ") + ".";
}

function matchesFilters(c, query, pickupOnly, ddpOnly) {
  if (pickupOnly && c.pickup_from_nantong !== "included" && c.pickup_from_nantong !== "paid") return false;
  if (ddpOnly && c.ddp_status !== "confirmed") return false;
  if (query) {
    const hay = [c.company, c.contact, c.phone, c.warehouse_city, c.file].join(" ").toLowerCase();
    if (!hay.includes(query.toLowerCase())) return false;
  }
  return true;
}

function renderTable() {
  const query = document.getElementById("search")?.value || "";
  const pickupOnly = document.getElementById("filter-pickup")?.checked || false;
  const ddpOnly = document.getElementById("filter-ddp")?.checked || false;

  let rows = DATA.complete.filter(c => matchesFilters(c, query, pickupOnly, ddpOnly));

  if (currentSort === "score") rows.sort((a, b) => b.score.total - a.score.total);
  else if (currentSort === "price") rows.sort((a, b) => a.final_total_usd - b.final_total_usd);
  else if (currentSort === "transit") rows.sort((a, b) => b.score.transit - a.score.transit);

  const minPrice = Math.min(...DATA.complete.map(c => c.final_total_usd));

  document.getElementById("main-table-body").innerHTML = rows.map(c => `
    <tr class="${c.rank <= 5 ? "top5-row" : ""}">
      <td>${c.rank}</td>
      <td><strong>${c.company}</strong><br><span style="color:var(--text-dim);font-size:0.8em">${c.contact}</span></td>
      <td>${c.phone}</td>
      <td style="font-size:0.78em;color:var(--text-dim)">${c.file}</td>
      <td>${c.price_per_kg_usd}</td>
      <td class="${c.final_total_usd === minPrice ? "best-price" : ""}">${fmtUsd(c.final_total_usd)}</td>
      <td>${pickupBadge(c.pickup_from_nantong)}</td>
      <td style="font-size:0.8em">${c.warehouse_address}</td>
      <td>${c.warehouse_city}</td>
      <td>${c.transit_time}</td>
      <td>${ddpBadge(c.ddp_status)}</td>
      <td>${includedList(c.included)}</td>
      <td style="font-size:0.8em">${c.additional_fees_desc}</td>
      <td><strong>${c.score.total}</strong></td>
      <td style="font-size:0.8em">${c.restrictions}</td>
      <td>${renderQuotesToggle(c)}</td>
    </tr>
  `).join("");
}

let quoteIdCounter = 0;
function renderQuotesToggle(c) {
  const id = "quotes-" + (quoteIdCounter++);
  const quotes = c.evidence.map(e => `<blockquote>“${e.quote}”<br><em>${e.note}</em></blockquote>`).join("");
  return `<button class="quote-toggle" onclick="document.getElementById('${id}').classList.toggle('hidden')">Цитаты</button>
    <div id="${id}" class="quotes-box hidden">${quotes}</div>`;
}

function renderDetailCards() {
  const rows = [...DATA.complete].sort((a, b) => a.rank - b.rank);
  document.getElementById("detail-cards").innerHTML = rows.map(c => `
    <div class="detail-card ${c.rank <= 5 ? "top5" : ""}">
      <h3>#${c.rank} ${c.company}</h3>
      <div class="contact-line">${c.contact} · ${c.phone} · файл: ${c.file}</div>
      <div>${ddpBadge(c.ddp_status)} ${pickupBadge(c.pickup_from_nantong)} <span class="badge badge-gray">Score: ${c.score.total}</span></div>

      <h4>Стоимость</h4>
      <ul>
        <li>Цена за кг: ${c.price_per_kg_original}</li>
        <li>Базовая стоимость (580 кг): ${fmtUsd(c.shipping_cost_usd)}</li>
        <li>Доп. сборы: ${fmtUsd(c.additional_fees_usd)} — ${c.additional_fees_desc}</li>
        <li><strong>Итого: ${fmtUsd(c.final_total_usd)}</strong></li>
        <li>Валюта оригинала: ${c.currency_original}</li>
      </ul>

      <h4>Условия доставки</h4>
      <ul>
        <li>Срок: ${c.transit_time}</li>
        <li>Минимальная партия/прочее: ${c.min_charge}</li>
        <li>Склад: ${c.warehouse_address}</li>
        <li>Город склада: ${c.warehouse_city}</li>
      </ul>

      <h4>Что включено</h4>
      ${includedList(c.included)}

      <h4>Риски / на что обратить внимание</h4>
      <p style="font-size:0.88rem">${c.restrictions}</p>

      <h4>Вопросы для уточнения перед оплатой</h4>
      <ul>${c.questions_to_clarify.map(q => `<li>${q}</li>`).join("")}</ul>

      <h4>Подтверждающие цитаты</h4>
      ${c.evidence.map(e => `<blockquote>“${e.quote}”<br><em>${e.note}</em></blockquote>`).join("")}
    </div>
  `).join("");
}

function renderIncomplete() {
  document.getElementById("incomplete-list").innerHTML = DATA.incomplete.map(c => `
    <div class="incomplete-card">
      <h3>${c.company}</h3>
      <div class="contact-line">${c.contact} · ${c.phone} · файл: ${c.file}</div>
      <div class="reason">${c.reason}</div>
      <div class="missing-tags">${c.missing.map(m => `<span class="missing-tag">${m}</span>`).join("")}</div>
      ${c.evidence.map(e => `<blockquote>“${e.quote}”<br><em>${e.note}</em></blockquote>`).join("")}
    </div>
  `).join("");
}

function renderMethodology() {
  const m = DATA.meta;
  document.getElementById("methodology").innerHTML = `
    <p>Курс конвертации: <strong>1 USD = ${m.rmb_to_usd_rate} RMB</strong> (фиксированный, использован для всех цен, изначально указанных в юанях).
    Базовый расчётный вес груза: <strong>${m.base_weight_kg} кг</strong> (192 комплекта постельного белья, 24 коробки).</p>

    <p>Если компания предоставила готовую итоговую цену — она использована как основной показатель.
    Если указана только ставка за кг — итог рассчитан как <code>цена_за_кг × ${m.base_weight_kg}</code> плюс отдельно озвученные дополнительные сборы (пикап, доставка до склада и т.п.).</p>

    <p>Компании, для которых невозможно надёжно определить итоговую стоимость, не включены в основной рейтинг и Топ-5 — они вынесены в отдельный раздел «Компании с неполными данными».</p>

    <h4 style="margin-top:18px">Веса рейтинга (0–100 баллов)</h4>
    <table>
      <tr><th>Критерий</th><th>Вес</th><th>Правило</th></tr>
      <tr><td>Цена</td><td>50%</td><td>Самая низкая цена получает максимум, остальные — пропорционально (50 × min/цена)</td></tr>
      <tr><td>Пикап из Nantong</td><td>20%</td><td>Включён в цену = 20, платный отдельно = 14, не организован но склад близко = 8, не организован и склад далеко = 3, неизвестно = 0</td></tr>
      <tr><td>Срок доставки</td><td>15%</td><td>Самый быстрый срок получает максимум, остальные — пропорционально (15 × самый_быстрый/срок), неизвестно = 0</td></tr>
      <tr><td>Прозрачность DDP</td><td>10%</td><td>Чётко подтверждён с разбивкой = 10, DDP заявлен без деталей = 7, частично понятно = 3, не DDP/неясно = 0</td></tr>
      <tr><td>Близость склада к Nantong</td><td>5%</td><td>Прямой пикап из Nantong = 5, Шанхай/Сучжоу/рядом = 4, Иу/Ханчжоу = 3, Гуанчжоу/Шэньчжэнь/юг = 1, неизвестно = 0</td></tr>
    </table>

    <p>Цены без подтверждённого DDP или без включённых пошлин/налогов отмечены как риск и не считаются напрямую сравнимыми с полными DDP-предложениями — это отражено в столбце «Риски / примечания» и в карточках компаний.</p>
  `;
}

function bindControls() {
  document.getElementById("search").addEventListener("input", renderTable);
  document.getElementById("filter-pickup").addEventListener("change", renderTable);
  document.getElementById("filter-ddp").addEventListener("change", renderTable);
  document.getElementById("sort-by").addEventListener("change", (e) => {
    currentSort = e.target.value;
    renderTable();
  });
  document.querySelectorAll("#main-table thead th").forEach((th, idx) => {
    th.addEventListener("click", () => {
      if (idx === 5) { currentSort = "price"; document.getElementById("sort-by").value = "price"; renderTable(); }
      if (idx === 9) { currentSort = "transit"; document.getElementById("sort-by").value = "transit"; renderTable(); }
      if (idx === 13) { currentSort = "score"; document.getElementById("sort-by").value = "score"; renderTable(); }
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
