#!/usr/bin/env python3
"""
Сборка китайской версии данных (purchases-zh.json) из китайских
markdown-карточек china-first-purchase/cards/<ID>/original-card-zh.md.

В отличие от import_archives.py, этот скрипт не работает с ZIP-архивами:
ассеты (фото/документы) уже извлечены в china-first-purchase/assets/<ID>/
основным (русским) импортом. Скрипт просто ищет одноимённые китайские
markdown-файлы и парсит их китайские заголовки/поля в тот же JSON-контракт,
который использует app-zh.js.

Использование:
    python china-first-purchase/scripts/import_zh_cards.py

Идемпотентен: можно запускать многократно.
"""

import json
import re
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SITE_DIR = SCRIPT_DIR.parent

CARDS_DIR = SITE_DIR / "cards"
DATA_DIR = SITE_DIR / "data"
PURCHASES_ZH_JSON = DATA_DIR / "purchases-zh.json"

PURCHASE_DATE_ZH = "2026年6月20日"
PURCHASE_LOCATION_ZH = "中国"

ALLOWED_STATUSES_ZH = ["货物已发出", "计划中", "准备中"]

NOT_SPECIFIED = "未提供"


# ---------------------------------------------------------------------------
# Текстовые помощники (аналогичны import_archives.py,但 работают с китайскими
# заголовками и метками полей)
# ---------------------------------------------------------------------------

def find_table_value(text, label):
    pattern = re.compile(
        r"^\s*\|\s*" + re.escape(label) + r"\s*\|\s*([^\|\n]*)\|?\s*$",
        re.MULTILINE,
    )
    m = pattern.search(text)
    if m:
        value = m.group(1).strip().strip("*").strip()
        return value if value else None
    return None


def find_bold_value(text, label):
    patterns = [
        r"\*\*" + re.escape(label) + r"\s*[:：]?\*\*\s*([^\n]+)",
        re.escape(label) + r"\s*[:：]?\s*\*\*([^\*\n]+)\*\*",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            value = m.group(1).strip().strip("*").strip()
            if value:
                return value
    return None


def get_field(text, *labels):
    for label in labels:
        value = find_table_value(text, label)
        if value:
            return value
    for label in labels:
        value = find_bold_value(text, label)
        if value:
            return value
    return None


def get_section(text, heading_regex):
    lines = text.split("\n")
    start = None
    start_level = None
    for i, line in enumerate(lines):
        hm = re.match(r"^(#{1,6})\s*(.+)$", line.strip())
        if not hm:
            continue
        if re.search(heading_regex, hm.group(2)):
            start = i
            start_level = len(hm.group(1))
            break
    if start is None:
        return None
    end = len(lines)
    for j in range(start + 1, len(lines)):
        hm = re.match(r"^(#{1,6})\s*(.+)$", lines[j].strip())
        if hm and len(hm.group(1)) <= start_level:
            end = j
            break
    section = "\n".join(lines[start + 1 : end]).strip()
    return section if section else None


def get_files_field(text, *label_regexes):
    results = []
    for line in text.split("\n"):
        line = line.strip()
        if not line.startswith("|"):
            continue
        cols = [c.strip() for c in line.strip("|").split("|")]
        if len(cols) < 2:
            continue
        label_col, value_col = cols[0], cols[-1]
        for lr in label_regexes:
            if re.match(lr, label_col):
                parts = [p.strip().strip("*") for p in value_col.split(",")]
                results.extend([p for p in parts if p])
                break
    return results


def parse_number(raw):
    if not raw:
        return None
    s = str(raw).strip()
    m = re.search(r"-?\d[\d\s.,]*", s)
    if not m:
        return None
    numstr = m.group(0).strip().replace(" ", "")
    if "," in numstr and "." in numstr:
        numstr = numstr.replace(",", "")
    elif "," in numstr:
        parts = numstr.split(",")
        if len(parts) == 2 and len(parts[1]) <= 3:
            numstr = numstr.replace(",", ".")
        else:
            numstr = numstr.replace(",", "")
    try:
        return float(numstr)
    except ValueError:
        return None


def parse_int(raw):
    n = parse_number(raw)
    return int(round(n)) if n is not None else None


def normalize_dimensions(raw):
    if not raw:
        return None
    value = raw.strip()
    value = re.sub(r"\s*/\s*", " × ", value)
    value = re.sub(r"\s*[xXхХ]\s*", " × ", value)
    value = re.sub(r"\s*×\s*", " × ", value)
    return value


def extract_card_id(text):
    patterns = [
        r"\*\*编号[:：]?\*\*\s*([A-Za-z0-9\-]+)",
        r"编号[:：]?\s*\*\*([A-Za-z0-9\-]+)\*\*",
        r"\b([A-Z]{2,6}-\d{8}-\d{2,4})\b",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(1).strip()
    return None


def extract_status(text):
    section = get_section(text, r"采购状态") or text
    raw = find_bold_value(section, "状态") or get_field(section, "状态")
    if not raw:
        return None
    return raw.strip().strip("*").strip()


def extract_payment_note(text):
    section = get_section(text, r"采购状态") or text
    raw = find_bold_value(section, "预付款") or get_field(section, "预付款")
    if not raw:
        return None
    return raw.strip().strip("*").strip()


def extract_action_required(text):
    section = get_section(text, r"需要您处理")
    if not section:
        return None
    return section.strip().strip("*").strip()


def extract_delivery_confirmed(text):
    section = get_section(text, r"货物已收到|确认收货")
    if not section:
        return None
    return section.strip().strip("*").strip()


def extract_money(text, label):
    raw = find_bold_value(text, label)
    if raw is None:
        raw = find_table_value(text, label)
    return parse_number(raw)


# ---------------------------------------------------------------------------
# Парсинг одной китайской markdown-карточки
# ---------------------------------------------------------------------------

def parse_zh_markdown(md_text):
    card_id = extract_card_id(md_text)
    title = get_field(md_text, "产品", "产品名称")

    status_raw = extract_status(md_text)
    if status_raw:
        normalized = status_raw.strip()
        match = next((s for s in ALLOWED_STATUSES_ZH if s == normalized), None)
        status = match if match else status_raw
    else:
        status = NOT_SPECIFIED

    payment_note = extract_payment_note(md_text)
    action_required = extract_action_required(md_text)
    delivery_confirmed = extract_delivery_confirmed(md_text)

    size = get_field(md_text, "尺寸")
    unit_price = parse_number(get_field(md_text, "采购单价", "采购单价（每件）"))
    currency = get_field(md_text, "货币")

    quantity = parse_int(get_field(md_text, "数量"))

    packaging_cost = parse_number(get_field(md_text, "单件包装费用"))
    bag_cost = parse_number(get_field(md_text, "单件包装袋费用"))

    unit_weight = parse_number(get_field(md_text, "单件重量"))
    unit_dimensions = normalize_dimensions(get_field(md_text, "单件尺寸"))
    unit_cbm = parse_number(get_field(md_text, "单件CBM", "单件 CBM"))

    box_dimensions = normalize_dimensions(get_field(md_text, "箱子尺寸"))
    box_count = parse_int(get_field(md_text, "箱数"))
    box_weight = parse_number(get_field(md_text, "箱重"))

    purchase_total = extract_money(md_text, "采购总额")
    invoice_total = extract_money(md_text, "发票总额")

    chat_name = get_field(md_text, "聊天备注名")
    supplier_name = get_field(md_text, "供应商名称", "名称")
    wechat_id = get_field(md_text, "微信号")
    phone = get_field(md_text, "电话")
    extra_contact = get_field(md_text, "其他联系方式")

    contact_parts = []
    if phone:
        contact_parts.append(f"电话：{phone}")
    if extra_contact:
        contact_parts.append(extra_contact)
    additional_contact = "；".join(contact_parts) if contact_parts else None

    photo_files = get_files_field(md_text, r"产品照片(\s*\d*)?$")
    invoice_photo_files = get_files_field(md_text, r"发票照片(\s*\d*)?$")
    supplier_photo_files = get_files_field(md_text, r"供应商.*照片.*")

    packaging_sea_ups = get_section(md_text, r"UPS")
    packaging_sea_truck = get_section(md_text, r"卡车")

    comments_block = get_section(md_text, r"备注")
    user_comment = None
    system_notes = None
    if comments_block:
        user_comment = get_field(comments_block, "用户备注") or get_section(
            comments_block, r"用户备注"
        )
        system_notes = get_field(comments_block, "系统备注") or get_section(
            comments_block, r"系统备注"
        )

    chat_section = get_section(md_text, r"聊天记录")
    chat_note = None
    chat_summary = None
    chat_history = None
    if chat_section:
        chat_note = get_section(chat_section, r"简短说明")
        chat_summary = get_section(chat_section, r"摘要")
        chat_history = get_section(chat_section, r"聊天记录（中文原文）|原始聊天记录|聊天记录原文")

    return {
        "id": card_id,
        "title": title or NOT_SPECIFIED,
        "status": status,
        "paymentNote": payment_note or NOT_SPECIFIED,
        "actionRequired": action_required or NOT_SPECIFIED,
        "deliveryConfirmed": delivery_confirmed or NOT_SPECIFIED,
        "size": size or NOT_SPECIFIED,
        "unitPrice": unit_price,
        "currency": currency or NOT_SPECIFIED,
        "quantity": quantity,
        "packagingCostPerUnit": packaging_cost,
        "bagCostPerUnit": bag_cost,
        "unitWeight": unit_weight,
        "unitDimensions": unit_dimensions or NOT_SPECIFIED,
        "unitCbm": unit_cbm,
        "purchaseTotal": purchase_total,
        "invoiceTotal": invoice_total,
        "chatName": chat_name or NOT_SPECIFIED,
        "supplierName": supplier_name or NOT_SPECIFIED,
        "wechatId": wechat_id or NOT_SPECIFIED,
        "additionalContact": additional_contact or NOT_SPECIFIED,
        "photoFiles": photo_files,
        "invoicePhotoFiles": invoice_photo_files,
        "supplierPhotoFiles": supplier_photo_files,
        "boxDimensions": box_dimensions,
        "boxCount": box_count,
        "boxWeight": box_weight,
        "packagingSeaUps": packaging_sea_ups or NOT_SPECIFIED,
        "packagingSeaTruck": packaging_sea_truck or NOT_SPECIFIED,
        "userComment": user_comment or NOT_SPECIFIED,
        "systemNotes": system_notes or NOT_SPECIFIED,
        "chatNote": chat_note,
        "chatSummary": chat_summary,
        "chatHistory": chat_history,
    }


def process_card(card_dir):
    md_path = card_dir / "original-card-zh.md"
    if not md_path.exists():
        return None

    md_text = md_path.read_text(encoding="utf-8")
    parsed = parse_zh_markdown(md_text)
    card_id = parsed["id"] or card_dir.name

    def asset_path(name):
        return f"assets/{card_id}/{name}" if name else None

    assets_dir = SITE_DIR / "assets" / card_id
    existing_assets = set()
    if assets_dir.exists():
        existing_assets = {p.name for p in assets_dir.iterdir() if p.is_file()}

    photos = [asset_path(n) for n in parsed["photoFiles"] if n in existing_assets]
    invoice_files = [
        asset_path(n) for n in parsed["invoicePhotoFiles"] if n in existing_assets
    ]
    supplier_files = [
        asset_path(n) for n in parsed["supplierPhotoFiles"] if n in existing_assets
    ]
    referenced = set(
        parsed["photoFiles"] + parsed["invoicePhotoFiles"] + parsed["supplierPhotoFiles"]
    )
    extra_documents = [
        asset_path(n) for n in sorted(existing_assets - referenced)
    ]

    card = {
        "id": card_id,
        "title": parsed["title"],
        "status": parsed["status"],
        "paymentNote": parsed["paymentNote"],
        "actionRequired": parsed["actionRequired"],
        "deliveryConfirmed": parsed["deliveryConfirmed"],
        "date": PURCHASE_DATE_ZH,
        "location": PURCHASE_LOCATION_ZH,
        "size": parsed["size"],
        "quantity": parsed["quantity"],
        "unitPrice": parsed["unitPrice"],
        "currency": parsed["currency"],
        "packagingCostPerUnit": parsed["packagingCostPerUnit"],
        "bagCostPerUnit": parsed["bagCostPerUnit"],
        "invoiceTotal": parsed["invoiceTotal"],
        "purchaseTotal": parsed["purchaseTotal"],
        "unitWeight": parsed["unitWeight"],
        "unitDimensions": parsed["unitDimensions"],
        "unitCbm": parsed["unitCbm"],
        "supplierName": parsed["supplierName"],
        "chatName": parsed["chatName"],
        "wechatId": parsed["wechatId"],
        "additionalContact": parsed["additionalContact"],
        "mainImage": photos[0] if photos else None,
        "photos": photos,
        "invoiceFiles": invoice_files,
        "supplierFiles": supplier_files,
        "extraDocuments": extra_documents,
        "boxDimensions": parsed["boxDimensions"],
        "boxCount": parsed["boxCount"],
        "boxWeight": parsed["boxWeight"],
        "packagingSeaUps": parsed["packagingSeaUps"],
        "packagingSeaTruck": parsed["packagingSeaTruck"],
        "userComment": parsed["userComment"],
        "systemNotes": parsed["systemNotes"],
        "chatNote": parsed["chatNote"],
        "chatSummary": parsed["chatSummary"],
        "chatHistory": parsed["chatHistory"],
        "chatOriginal": None,
        "originalMarkdownPath": f"cards/{card_id}/original-card-zh.md",
        "rawMarkdown": md_text,
        "warnings": [],
    }
    return card


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    card_dirs = sorted(p for p in CARDS_DIR.iterdir() if p.is_dir())

    cards = []
    for card_dir in card_dirs:
        try:
            card = process_card(card_dir)
        except Exception as exc:  # noqa: BLE001
            print(f"[错误] 无法处理 {card_dir.name}: {exc}")
            continue
        if card is None:
            continue
        cards.append(card)
        print(f"已处理：{card_dir.name} -> {card['id']}")

    cards.sort(key=lambda c: c["id"])

    PURCHASES_ZH_JSON.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"\n完成。共处理卡片数：{len(cards)}。")
    print(f"数据已保存至 {PURCHASES_ZH_JSON}")


if __name__ == "__main__":
    main()
