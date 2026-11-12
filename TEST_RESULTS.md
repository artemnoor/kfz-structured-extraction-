# Structured Extraction — локальные результаты проверок

Дата: 2026-11-12 20:52 MSK

Коммит кода под проверкой: `99b5634f0f0c63d4dde6345b248c41a5ca3a9b49`

Среда: Windows, PowerShell, локальный Worker и локальная D1.

## Результаты

| Проверка | Результат | Примечания |
| --- | --- | --- |
| `npm test` | PASS — 40/40 | Parser, provenance, extraction, Compare, confidence, Polza adapter, security, D1 seed. |
| `npm run test:api` | PASS | Локальная D1, авторизация, импорт, версии входа, история и повторное чтение. |
| `npm run test:polza` | PASS | Реальный `GET /models`, Compare-запрос к `deepseek/deepseek-v4-flash`, локальная валидация и сохранение/повторное чтение результата из D1. Тест завершился без `SKIP`. |
| `npm run build` | PASS | Production build завершён. |
| `npm run db:migrate:local` | PASS | Wrangler использовал только local resource; миграций к применению нет. |
| `git diff --check` | PASS | Ошибок whitespace нет. |

## Ограничения и предупреждения

- Реальный LLM smoke проверяет один демонстрационный документ КФЗ; это не оценка точности модели по всем типам документов.
- `npm test` использует синтетические fixtures и oracle assertions. Их результаты не являются независимой оценкой качества на реальном корпусе.
- Build вывел предупреждения Node.js о `punycode` и experimental `glob`, предупреждение о времени работы Vite plugins и замечание Vinext о статической классификации динамических API-маршрутов. Сборка завершилась успешно.

Ключ Polza не включён в этот отчёт. Проверки выполнялись на локальной D1; production D1 и deployment не использовались.

## Real-document benchmark — 2026-11-12

Baseline выполнен на коде Structured Extraction `1e922e284805f2c1b343b4cb369813c8073b67dd` и Document Parser `4c2fd27ae6f7ebd0a9a9f9c052099c12b56f5e84`.

| Проверка | Результат | Примечания |
| --- | --- | --- |
| Локальный Document Parser | PASS — 22/22 | Все уникальные первичные PDF, DOCX, XLSX и PNG завершились; использованы Docling 2.72.0 и локальный RapidOCR Cyrillic PP-OCRv5. |
| Rules Only через адаптер | PASS — 22/22 | Ошибок выполнения нет. PASS означает завершение pipeline, не точность. |
| Classification на поддерживаемых типах | 4/8 корректно | Accuracy / micro F1 — 50%; 14 документов без профильной схемы исключены из оценки. |
| Целевая строка КФЗ | FAIL — 0/15 ячеек | 18 строк имеют `row_status: extracted`, но все их значения missing; таблица удвоилась с 9 до 18 строк при адаптации. |
| Provenance consistency | PASS — 43/43 | ID, locator, доступность источника и исходный текст согласованы; это не оценка semantic accuracy. |
| Polza smoke на synthetic demo | PASS | 1 GET `/models`, 1 Compare completion, результат сохранён и повторно прочитан из локальной D1. |
| Corpus LLM Assisted / Compare | NOT RUN | Потенциально конфиденциальные зарплатные и страховые документы не отправлялись во внешний API. |
| Document Parser unit tests | PASS — 77/77 | `python -m unittest discover -s backend/tests -v`. |
| Structured Extraction unit tests | PASS — 40/40 | `npm test`. |
| API smoke | PASS | `npm run test:api`. |
| Production build | PASS | `npm run build`; есть предупреждения зависимостей и статического анализа Vinext. |

Подробности, метрики и границы разметки: [BENCHMARK_REPORT.md](BENCHMARK_REPORT.md). Публичные JSON результаты обезличены; полный parser JSON, документы и эталонные значения остались в локальном исключённом каталоге.

## Повторная проверка после исправлений — 2026-11-13

Ветка: `fix/structured-extraction-real-docs`. Проверки проводились в Windows, на локальном Worker и локальной D1.

| Проверка | Результат | Примечания |
|---|---|---|
| `npm test` | PASS — 44/44 | Включены регрессии таблиц и фрагментов Parser, 15 ячеек КФЗ, неполных строк, классификации без имени файла и явного LLM allowlist. |
| Свежий Document Parser на корпусе | PASS — 22/22 | Исходные документы обработаны заново; 5 с локальным OCR; сохранённые Parser JSON не использовались. |
| Rules Only на корпусе | PASS — 22/22 | Ошибок извлечения нет. Полевые метрики всего корпуса — `not_scored`. |
| Строка КФЗ | PASS — 15/15 контрольных значений | Совпали с отдельной ручной разметкой; все значения имеют исходный текст, page 1, bbox и source ref. Строка остаётся `review` из-за пустого дополнительного поля. |
| Формальная классификационная accuracy | NOT SCORED | Все 22 вывода совпали с исследовательскими метками индекса корпуса; метки не являются слепой независимой экспертной разметкой. |
| `npm run test:api` | PASS | API, локальная D1, local sign-in, spoofed-header rejection, rules-only rerun, history readback и anonymous write denial. |
| Реальный `GET /models` и Compare | PASS — 1 completion | `deepseek/deepseek-v4-flash`, ответ реально получен, проверен и сохранён/прочитан из локальной D1. Compare: 27 matches, 2 discrepancies, 1 llm-only. |
| Отдельный API режим `llm_assisted` | BLOCKED — HTTP 429 | Локальная дневная demo-квота закончилась до обращения к провайдеру. Лимит не обходился; успешный inference этому запуску не приписан. |
| `npm run test:polza` после расширения до двух режимов | FAIL — дневной лимит | Предыдущий одно-вызовный Compare smoke завершился PASS; следующая попытка отдельного режима `llm_assisted` была отклонена локальной квотой до inference. |
| `npm run db:migrate:local` | PASS | Локальная база, миграций к применению нет; production D1 не затрагивалась. |
| `npm run build` | PASS | Production build завершён; остаётся предупреждение Vinext о статическом определении dynamic API routes. |
| Проверка браузером | PASS | Локальная главная страница открылась, title `КФЗ · Structured Extraction`, список demo-документов и экран извлечения отрендерились. |

Детали повторного benchmark и ограничения: [BENCHMARK_REPORT_AFTER_FIXES.md](BENCHMARK_REPORT_AFTER_FIXES.md). Обезличенные machine-readable результаты: [summary.json](benchmarks/results/after-fixes/summary.json) и [per-document.json](benchmarks/results/after-fixes/per-document.json). Корпусные документы не отправлялись Polza.
