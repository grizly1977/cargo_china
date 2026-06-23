#!/usr/bin/env python3
"""
Импорт ZIP-архивов карточек закупки из purchase-archives/ в сайт china-first-purchase/.

Использование:
    python china-first-purchase/scripts/import_archives.py

Скрипт идемпотентен: можно запускать многократно, старые данные карточки
обновляются из последнего обработанного ZIP с тем же номером карточки.
"""

import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SITE_DIR = SCRIPT_DIR.parent
REPO_ROOT = SITE_DIR.parent

ARCHIVES_DIR = REPO_ROOT / "purchase-archives"
ASSETS_DIR = SITE_DIR / "assets"
CARDS_DIR = SITE_DIR / "cards"
DATA_DIR = SITE_DIR / "data"
PURCHASES_JSON = DATA_DIR / "purchases.json"

PURCHASE_DATE = "20 июня 2026 года"
PURCHASE_LOCATION = "Китай"

ALLOWED_STATUSES = ["товар отправлен", "планируется", "подготавливается"]

NOT_SPECIFIED = "не указано"

DOCUMENT_EXTENSIONS = {".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt"}


# ---------------------------------------------------------------------------
# Текстовые помощники для разбора Markdown
# ---------------------------------------------------------------------------

def find_table_value(text, label):
    pattern = re.compile(
        r"^\s*\|\s*" + re.escape(label) + r"\s*\|\s*([^\|\n]*)\|?\s*$",
        re.MULTILINE | re.IGNORECASE,
    )
    m = pattern.search(text)
    if m:
        value = m.group(1).strip().strip("*").strip()
        return value if value else None
    return None


def find_bold_value(text, label):
    patterns = [
        r"\*\*" + re.escape(label) + r"\s*:?\*\*\s*([^\n]+)",
        re.escape(label) + r"\s*:?\s*\*\*([^\*\n]+)\*\*",
    ]
    for p in patterns:
        m = re.search(p, text, re.IGNORECASE)
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
    """Возвращает текст под заголовком (## или ###), совпадающим с heading_regex,
    до следующего заголовка того же или более высокого уровня."""
    lines = text.split("\n")
    start = None
    start_level = None
    for i, line in enumerate(lines):
        hm = re.match(r"^(#{1,6})\s*(.+)$", line.strip())
        if not hm:
            continue
        if re.search(heading_regex, hm.group(2), re.IGNORECASE):
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
    """Извлекает список имён файлов из табличных строк, где название поля
    совпадает с одним из label_regexes (например 'Фото товара', 'Фото товара 1')."""
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
            if re.match(lr, label_col, re.IGNORECASE):
                parts = [p.strip().strip("*") for p in value_col.split(",")]
                results.extend([p for p in parts if p])
                break
    return results


def parse_number(raw):
    if not raw:
        return None
    s = str(raw).strip().replace(" ", " ")
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
        r"\*\*Номер:?\*\*\s*([A-Za-z0-9\-]+)",
        r"Номер:?\s*\*\*([A-Za-z0-9\-]+)\*\*",
        r"Номер\s*карточки[\s\S]{0,200}?([A-Z]{2,6}-\d{6,10}-\d{1,5})",
        r"\b([A-Z]{2,6}-\d{8}-\d{2,4})\b",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            return m.group(1).strip()
    return None


def extract_status(text):
    section = get_section(text, r"Статус\s*закупки") or text
    raw = find_bold_value(section, "Статус") or get_field(section, "Статус")
    if not raw:
        return None
    return raw.strip().strip("*").strip()


def extract_payment_note(text):
    section = get_section(text, r"Статус\s*закупки") or text
    raw = find_bold_value(section, "Предоплата") or get_field(section, "Предоплата")
    if not raw:
        return None
    return raw.strip().strip("*").strip()


def extract_action_required(text):
    section = get_section(text, r"Требуется\s*действие")
    if not section:
        raw = find_bold_value(text, "Требуется действие")
        section = raw.strip() if raw else None
    if not section:
        return None
    return section.strip().strip("*").strip()


def extract_money(text, label):
    raw = find_bold_value(text, label)
    if raw is None:
        raw = find_table_value(text, label)
    return parse_number(raw)


# ---------------------------------------------------------------------------
# Парсинг одной markdown-карточки
# ---------------------------------------------------------------------------

def parse_markdown_card(md_text):
    warnings = []

    card_id = extract_card_id(md_text)
    if not card_id:
        warnings.append("Не удалось извлечь номер карточки из Markdown.")

    title = get_field(md_text, "Товар", "Наименование товара")
    if not title:
        warnings.append("Не удалось извлечь наименование товара из Markdown.")

    status_raw = extract_status(md_text)
    if not status_raw:
        warnings.append("Не удалось извлечь статус закупки из Markdown.")
        status = NOT_SPECIFIED
    else:
        normalized = status_raw.strip().lower()
        match = next((s for s in ALLOWED_STATUSES if s == normalized), None)
        if match:
            status = match
        else:
            status = status_raw
            warnings.append(
                f"Статус «{status_raw}» не входит в разрешённый список статусов."
            )

    payment_note = extract_payment_note(md_text)
    action_required = extract_action_required(md_text)

    size = get_field(md_text, "Размер")
    unit_price = parse_number(
        get_field(md_text, "Цена закупки за 1 штуку", "Цена закупки за единицу")
    )
    currency = get_field(md_text, "Валюта")
    if not currency:
        price_raw = get_field(
            md_text, "Цена закупки за 1 штуку", "Цена закупки за единицу"
        )
        if price_raw:
            cm = re.search(r"[A-Za-z]{3}", price_raw)
            if cm:
                currency = cm.group(0).upper()

    quantity = parse_int(get_field(md_text, "Количество", "Количество штук"))

    packaging_cost = parse_number(
        get_field(
            md_text,
            "Стоимость упаковки за 1 штуку",
            "Стоимость упаковки за единицу",
        )
    )
    bag_cost = parse_number(
        get_field(
            md_text,
            "Стоимость товарной сумки за 1 штуку",
            "Стоимость товарной сумки за единицу",
        )
    )

    unit_weight = parse_number(
        get_field(md_text, "Вес 1 единицы товара", "Вес единицы товара")
    )
    unit_dimensions = normalize_dimensions(
        get_field(md_text, "Габариты 1 единицы товара", "Габариты единицы товара")
    )
    unit_cbm = parse_number(get_field(md_text, "CBM единицы товара"))

    purchase_total = extract_money(md_text, "Стоимость закупки")
    invoice_total = extract_money(md_text, "Общая стоимость инвойса")

    chat_name = get_field(md_text, "Имя чата")
    supplier_name = get_field(md_text, "Name")
    wechat_id = get_field(md_text, "WeChat ID")
    phone = get_field(md_text, "Телефон")
    extra_contact = get_field(md_text, "Дополнительная контактная информация")

    contact_parts = []
    if phone:
        contact_parts.append(f"Телефон: {phone}")
    if extra_contact:
        contact_parts.append(extra_contact)
    additional_contact = "; ".join(contact_parts) if contact_parts else None

    photo_files = get_files_field(md_text, r"Фото\s*товара(\s*\d*)?$")
    invoice_photo_files = get_files_field(md_text, r"Фото\s*инвойса(\s*\d*)?$")
    supplier_photo_files = get_files_field(
        md_text, r"Фото\s*поставщика.*", r"Фото\s*поставщика\s*или\s*чата.*"
    )

    packaging_sea_ups = get_section(md_text, r"\bUPS\b")
    packaging_sea_truck = get_section(md_text, r"\bтрак\b")

    comments_block = get_section(md_text, r"Комментар")
    user_comment = None
    system_notes = None
    if comments_block:
        user_comment = get_field(
            comments_block, "Комментарий пользователя"
        ) or get_section(comments_block, r"Комментарий\s*пользовател")
        system_notes = get_field(
            comments_block, "Системные замечания"
        ) or get_section(comments_block, r"Системные\s*замечани")

    chat_section = get_section(md_text, r"История\s*переписки")
    chat_summary = None
    chat_history = None
    chat_original = None
    if chat_section:
        chat_summary = get_section(chat_section, r"Резюме")
        chat_history = get_section(chat_section, r"Переписка")
        chat_original = get_section(chat_section, r"Оригинал\s*переписки")

    return {
        "id": card_id,
        "title": title or NOT_SPECIFIED,
        "status": status,
        "paymentNote": payment_note or NOT_SPECIFIED,
        "actionRequired": action_required or NOT_SPECIFIED,
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
        "packagingSeaUps": packaging_sea_ups or NOT_SPECIFIED,
        "packagingSeaTruck": packaging_sea_truck or NOT_SPECIFIED,
        "userComment": user_comment or NOT_SPECIFIED,
        "systemNotes": system_notes or NOT_SPECIFIED,
        "chatSummary": chat_summary,
        "chatHistory": chat_history,
        "chatOriginal": chat_original,
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Обработка одного ZIP-архива
# ---------------------------------------------------------------------------

def process_zip(zip_path):
    archive_name = zip_path.name

    with zipfile.ZipFile(zip_path) as zf:
        members = [m for m in zf.namelist() if not m.endswith("/")]
        md_members = [m for m in members if m.lower().endswith(".md")]

        if len(md_members) == 0:
            print(f"[ПРЕДУПРЕЖДЕНИЕ] {archive_name}: в архиве не найден .md файл. Архив пропущен.")
            return None

        if len(md_members) > 1:
            print(
                f"[ПРЕДУПРЕЖДЕНИЕ] {archive_name}: найдено {len(md_members)} .md файлов. "
                "Архив не обработан, исправьте архив (должен быть ровно один .md файл)."
            )
            return None

        md_member = md_members[0]
        md_text = zf.read(md_member).decode("utf-8", errors="replace")

        parsed = parse_markdown_card(md_text)
        card_id = parsed["id"]
        if not card_id:
            # без номера карточки невозможно разместить файлы — используем имя архива
            card_id = re.sub(r"_package$", "", zip_path.stem).upper()
            print(
                f"[ПРЕДУПРЕЖДЕНИЕ] {archive_name}: номер карточки не извлечён, "
                f"использован резервный идентификатор {card_id}."
            )

        other_members = [m for m in members if m != md_member]

        # имена файлов, упомянутые в markdown
        referenced = set(
            parsed["photoFiles"]
            + parsed["invoicePhotoFiles"]
            + parsed["supplierPhotoFiles"]
        )

        basenames_in_zip = {}
        for member in other_members:
            basename = Path(member).name
            if basename in basenames_in_zip:
                print(
                    f"[ПРЕДУПРЕЖДЕНИЕ] {archive_name}: повторяющееся имя файла "
                    f"'{basename}' в архиве, использован первый найденный."
                )
                continue
            basenames_in_zip[basename] = member

        warnings = list(parsed["warnings"])

        for ref in referenced:
            if ref not in basenames_in_zip:
                warnings.append(
                    f"Файл «{ref}» указан в Markdown, но отсутствует в архиве."
                )

        extra_documents = []
        for basename in basenames_in_zip:
            if basename not in referenced:
                extra_documents.append(basename)
        if extra_documents:
            warnings.append(
                "В архиве есть дополнительные файлы, не упомянутые в Markdown: "
                + ", ".join(sorted(extra_documents))
            )

        # подготовка папок назначения
        card_assets_dir = ASSETS_DIR / card_id
        card_dir = CARDS_DIR / card_id
        if card_assets_dir.exists():
            shutil.rmtree(card_assets_dir)
        card_assets_dir.mkdir(parents=True, exist_ok=True)
        card_dir.mkdir(parents=True, exist_ok=True)

        for basename, member in basenames_in_zip.items():
            target = card_assets_dir / basename
            with zf.open(member) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)

        (card_dir / "original-card.md").write_text(md_text, encoding="utf-8")

    def asset_path(name):
        return f"assets/{card_id}/{name}" if name else None

    photos = [asset_path(n) for n in parsed["photoFiles"] if n in basenames_in_zip]
    invoice_files = [
        asset_path(n) for n in parsed["invoicePhotoFiles"] if n in basenames_in_zip
    ]
    supplier_files = [
        asset_path(n) for n in parsed["supplierPhotoFiles"] if n in basenames_in_zip
    ]
    extra_doc_paths = [asset_path(n) for n in sorted(extra_documents)]

    card = {
        "id": card_id,
        "title": parsed["title"],
        "status": parsed["status"],
        "paymentNote": parsed["paymentNote"],
        "actionRequired": parsed["actionRequired"],
        "date": PURCHASE_DATE,
        "location": PURCHASE_LOCATION,
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
        "extraDocuments": extra_doc_paths,
        "packagingSeaUps": parsed["packagingSeaUps"],
        "packagingSeaTruck": parsed["packagingSeaTruck"],
        "userComment": parsed["userComment"],
        "systemNotes": parsed["systemNotes"],
        "chatSummary": parsed["chatSummary"],
        "chatHistory": parsed["chatHistory"],
        "chatOriginal": parsed["chatOriginal"],
        "originalMarkdownPath": f"cards/{card_id}/original-card.md",
        "rawMarkdown": md_text,
        "warnings": warnings,
    }

    for w in warnings:
        print(f"[ПРЕДУПРЕЖДЕНИЕ] {card_id}: {w}")

    return card


def main():
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    CARDS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)

    zip_paths = sorted(ARCHIVES_DIR.glob("*.zip"))

    if not zip_paths:
        print(f"В папке {ARCHIVES_DIR} не найдено ZIP-архивов. Создаю пустой purchases.json.")
        PURCHASES_JSON.write_text("[]\n", encoding="utf-8")
        return

    cards_by_id = {}
    for zip_path in zip_paths:
        print(f"Обработка архива: {zip_path.name}")
        try:
            card = process_zip(zip_path)
        except Exception as exc:  # noqa: BLE001
            print(f"[ОШИБКА] Не удалось обработать {zip_path.name}: {exc}")
            continue
        if card is None:
            continue
        cards_by_id[card["id"]] = card

    cards = list(cards_by_id.values())
    cards.sort(key=lambda c: c["id"])

    PURCHASES_JSON.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"\nГотово. Обработано карточек: {len(cards)}.")
    print(f"Данные сохранены в {PURCHASES_JSON}")


if __name__ == "__main__":
    main()
