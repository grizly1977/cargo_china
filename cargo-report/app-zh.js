let DATA = null;
let currentSort = "score";

const fmtUsd = (v) => "$" + Number(v).toFixed(2).replace(/\.00$/, "");

const DDP_LABELS = {
  confirmed: { text: "DDP已确认", cls: "badge-green" },
  partial: { text: "DDP部分确认", cls: "badge-yellow" },
  unclear: { text: "需要进一步确认", cls: "badge-red" },
};

const PICKUP_LABELS = {
  included: { text: "已包含", cls: "badge-green" },
  paid: { text: "付费提供", cls: "badge-yellow" },
  not_available: { text: "未提供", cls: "badge-red" },
  unknown: { text: "需要确认", cls: "badge-gray" },
};

const INCLUDED_LABELS = {
  sea: "海运", truck: "卡车运输", customs: "清关", duties: "关税",
  taxes: "税费", door: "送货到门", warehouse_handling: "仓库操作", pickup: "提货",
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
  const res = await fetch("data-zh.json");
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
    `生成日期：${m.generated_at} · 已分析聊天记录：${m.total_chats_analyzed} 条 · ` +
    `数据完整的公司：${m.complete_companies} 家 · 数据不完整的公司：${m.incomplete_companies} 家 · ` +
    `货物：${m.cargo_summary.product}，${m.cargo_summary.gross_weight_kg} 公斤，${m.cargo_summary.origin} → ${m.cargo_summary.destination}`;
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
    { label: "最便宜的公司", value: cheapest.company, sub: `总计 ${fmtUsd(cheapest.final_total_usd)}` },
    { label: "综合最优方案（评分）", value: bestOverall.company, sub: `评分：${bestOverall.score.total}` },
    { label: "运输速度最快", value: fastest ? fastest.company : "未提供", sub: fastest ? fastest.transit_time : "" },
    { label: "南通提货最优方案", value: bestPickup.company, sub: PICKUP_LABELS[bestPickup.pickup_from_nantong]?.text || "" },
    { label: "平均每公斤价格", value: "$" + avgPerKg.toFixed(2), sub: "基于所有数据完整的公司" },
    { label: "总价区间", value: `${fmtUsd(minPrice)} – ${fmtUsd(maxPrice)}`, sub: "美元，DDP可比报价" },
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
      <div class="meta-line">${c.price_per_kg_usd} $/公斤 · ${c.transit_time}</div>
      <div class="meta-line">${pickupBadge(c.pickup_from_nantong)} ${ddpBadge(c.ddp_status)}</div>
      <div class="meta-line">评分：<strong>${c.score.total}</strong></div>
      <div class="rationale">${topRationale(c)}</div>
    </div>
  `).join("");
}

function topRationale(c) {
  const parts = [];
  if (c.score.price >= 40) parts.push("价格处于最低水平之一");
  if (c.pickup_from_nantong === "included") parts.push("南通提货已包含在价格内");
  if (c.ddp_status === "confirmed") parts.push("DDP条款明确");
  if (c.score.transit >= 12) parts.push("运输时效相对较快");
  if (!parts.length) parts.push("价格、时效与条款的均衡组合");
  return parts.join("，") + "。";
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
  return `<button class="quote-toggle" onclick="document.getElementById('${id}').classList.toggle('hidden')">查看引用</button>
    <div id="${id}" class="quotes-box hidden">${quotes}</div>`;
}

function renderDetailCards() {
  const rows = [...DATA.complete].sort((a, b) => a.rank - b.rank);
  document.getElementById("detail-cards").innerHTML = rows.map(c => `
    <div class="detail-card ${c.rank <= 5 ? "top5" : ""}">
      <h3>#${c.rank} ${c.company}</h3>
      <div class="contact-line">${c.contact} · ${c.phone} · 文件：${c.file}</div>
      <div>${ddpBadge(c.ddp_status)} ${pickupBadge(c.pickup_from_nantong)} <span class="badge badge-gray">评分：${c.score.total}</span></div>

      <h4>费用</h4>
      <ul>
        <li>每公斤价格：${c.price_per_kg_original}</li>
        <li>基础运费（580公斤）：${fmtUsd(c.shipping_cost_usd)}</li>
        <li>附加费用：${fmtUsd(c.additional_fees_usd)} — ${c.additional_fees_desc}</li>
        <li><strong>总计：${fmtUsd(c.final_total_usd)}</strong></li>
        <li>原始货币：${c.currency_original}</li>
      </ul>

      <h4>运输条件</h4>
      <ul>
        <li>时效：${c.transit_time}</li>
        <li>最低收费/其他：${c.min_charge}</li>
        <li>仓库地址：${c.warehouse_address}</li>
        <li>仓库所在城市：${c.warehouse_city}</li>
      </ul>

      <h4>包含服务</h4>
      ${includedList(c.included)}

      <h4>风险 / 注意事项</h4>
      <p style="font-size:0.88rem">${c.restrictions}</p>

      <h4>付款前需确认的问题</h4>
      <ul>${c.questions_to_clarify.map(q => `<li>${q}</li>`).join("")}</ul>

      <h4>原始聊天引用</h4>
      ${c.evidence.map(e => `<blockquote>“${e.quote}”<br><em>${e.note}</em></blockquote>`).join("")}
    </div>
  `).join("");
}

function renderIncomplete() {
  document.getElementById("incomplete-list").innerHTML = DATA.incomplete.map(c => `
    <div class="incomplete-card">
      <h3>${c.company}</h3>
      <div class="contact-line">${c.contact} · ${c.phone} · 文件：${c.file}</div>
      <div class="reason">${c.reason}</div>
      <div class="missing-tags">${c.missing.map(m => `<span class="missing-tag">${m}</span>`).join("")}</div>
      ${c.evidence.map(e => `<blockquote>“${e.quote}”<br><em>${e.note}</em></blockquote>`).join("")}
    </div>
  `).join("");
}

function renderMethodology() {
  const m = DATA.meta;
  document.getElementById("methodology").innerHTML = `
    <p>换算汇率：<strong>1 美元 = ${m.rmb_to_usd_rate} 人民币</strong>（固定汇率，适用于所有原始以人民币标价的费用）。
    基础计费重量：<strong>${m.base_weight_kg} 公斤</strong>（192套床上用品，24箱）。</p>

    <p>如果公司提供了明确的总价，则以该总价作为主要依据。
    如果只提供了每公斤单价，则总价按 <code>每公斤单价 × ${m.base_weight_kg}</code> 加上单独说明的附加费用（提货、送至仓库等）计算。</p>

    <p>无法可靠确定总费用的公司未纳入主排名和前五名——这些公司被列入单独的「数据不完整的公司」部分。</p>

    <h4 style="margin-top:18px">评分权重（满分100）</h4>
    <table>
      <tr><th>评分项</th><th>权重</th><th>规则</th></tr>
      <tr><td>价格</td><td>50%</td><td>最低价格获得满分，其余按比例计算（50 × 最低价/该公司价格）</td></tr>
      <tr><td>南通提货</td><td>20%</td><td>已包含在价格内 = 20分，单独付费 = 14分，未提供但仓库较近 = 8分，未提供且仓库较远 = 3分，未知 = 0分</td></tr>
      <tr><td>运输时效</td><td>15%</td><td>最快时效获得满分，其余按比例计算（15 × 最快时效/该公司时效），未知 = 0分</td></tr>
      <tr><td>DDP透明度</td><td>10%</td><td>明确确认并有费用明细 = 10分，声明DDP但无明细 = 7分，部分明确 = 3分，非DDP/不明确 = 0分</td></tr>
      <tr><td>仓库距南通的距离</td><td>5%</td><td>直接从南通提货 = 5分，上海/苏州等周边 = 4分，义乌/杭州 = 3分，广州/深圳等南方 = 1分，未知 = 0分</td></tr>
    </table>

    <p>未确认DDP或未包含关税/税费的价格被标记为风险，不能直接与完整DDP报价相比——这一点已在「风险 / 备注」列和公司详情卡片中说明。</p>
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
