# Воспроизведение локального benchmark

Benchmark использует оригинальные файлы корпуса из локального checkout `list-document-viewer`. В репозитории Structured Extraction нет копий документов, parser JSON, исходных фрагментов или полной эталонной разметки. Секрет Polza не требуется для локального Parser и Rules Only.

## Parser и OCR

Используйте Python 3.11 и зависимости, закреплённые в `list-document-viewer/backend/requirements.txt`. Перейдите в checkout Document Parser, отключите его необязательные сетевые OCR review/fallback и запустите локальные тесты:

```powershell
$env:POLZA_OCR_ENABLED = '0'
python -m unittest discover -s backend/tests -v
```

Для corpus прогоняйте исходники через `backend/extraction.py:analyze`, затем применяйте `server.normalize_tables`; для PDF также вызывайте `pdf_layout.extract_pdf_layout` и `merge_model_layout`. Не используйте сохранённые `data/parser-results` Structured Extraction как замену свежему разбору. Настоящий запуск использовал Docling 2.72.0 и локальный Cyrillic PP-OCRv5; фактические JSON были сохранены вне Git в исключённом `backend/tests/corpus/`.

При повторе исключите описание набора и эталонный XLSX из числа документов, проверьте SHA-256 и не запускайте побайтовую копию второй раз. Входной каталог содержит персональные/платёжные категории: не включайте необязательные внешние сервисы и не отправляйте эти файлы в Polza без подтверждённого разрешения.

## Structured Extraction

Для каждого свежего parser result используйте публичные функции:

```js
import { adaptDocumentParserResult } from "../lib/parser/document-parser-adapter.mjs";
import { extractStructuredDocument } from "../lib/extraction/structured-extraction.mjs";

const adapted = adaptDocumentParserResult(parserJson);
const result = extractStructuredDocument(parserJson, { mode: "rules_only" });
```

При подсчёте provenance сверяйте source ID с элементами `adapted.elements`, наличие locator, `source_available` и исходный текст. Не считайте `row_status: extracted` достаточным подтверждением заполненной строки.

Classification labels для этого прогона назначены по исходным именам/заголовкам файлов, независимо от результата Structured Extraction; сам классификатор также получает имя файла, поэтому оценка не слепая. Целевая строка КФЗ независимо размечена по исходной странице и сверена с предоставленной книгой ответов. Приватная разметка и полные значения остаются рядом с локальным корпусом; в Git опубликованы только DOC-ID и агрегированные счётчики. Текущий публичный результат отмечает неразмеченные поля как `not_scored`, а не строит их ожидаемые значения из кода извлечения.

## Проверки приложения и Polza

В checkout приложения:

```powershell
npm test
npm run test:api
npm run build
```

`npm run test:polza` требует локальный Worker, ключ в `.dev.vars` и доступ к Polza. Существующий smoke использует только демонстрационный synthetic документ и проверяет `/models`, один Compare и сохранение/чтение D1. Не меняйте тест так, чтобы он отправлял пользовательские документы без разрешения.

## Что не означает этот отчёт

Успешный Parser status не является оценкой OCR accuracy. 43/43 — проверка лексического grounding уже выданных значений, не полная semantic precision. Field metrics, Hallucination Rate и корпусный Compare останутся `not_scored` до завершения независимой разметки и безопасного разрешения на внешнюю обработку.
