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

## Продолжение независимой проверки — 2026-11-13

Проверки в существующей ветке `fix/structured-extraction-real-docs`, локальный Worker/D1, Windows. Эта секция отражает текущий код и заменяет более ранние значения по количеству unit-тестов.

| Проверка | Результат | Примечания |
|---|---|---|
| `npm test` | PASS — 47/47 | Включены семантические поля 15 колонок КФЗ, единицы, provenance, акты/счета-акты, месячный период XLSX и запрет ложного заполнения полей представителя/замечаний. |
| `npm run test:api` | PASS | Локальная D1, авторизация, импорт, Rules Only повторный запуск, история, stale-input и запрет анонимной записи. |
| `npm run test:polza` | BLOCKED — HTTP 429 `AI_DAILY_LIMIT` | Локальный demo-лимит остановил первый запрос до Polza. `retry_after=6518s`; защита не менялась. После штатного сброса требуется повторить два synthetic inference режима. |
| `npm run build` | PASS | Production build успешен; остались предупреждения `punycode`/experimental `glob`, времени Vite plugins и статического анализа Vinext API-маршрутов. |
| `npm run db:migrate:local` | PASS | Использован только local D1; миграций к применению нет. |
| `git diff --check` | PASS | Ошибок diff/whitespace нет. |
| Rules Only по имеющимся Parser-результатам | PASS — 22/22 | 183/183 принятых значений разрешаются к исходному тексту и источнику. Результаты Parser использованы повторно; OCR не запускался. |
| Независимая выборка оригиналов | PASS scoped — 5 документов | Классификация 5/5; ручные проверки полей 14/14, нормализации 25/25. Общие метрики всего корпуса не заявляются. |
| КФЗ | PASS scoped — 15/15 | Проверены значения, смысловые колонки и физические локаторы. Целевая строка остаётся `review` из-за пустой ячейки. |

На момент этой записи реальный синтетический Compare из предыдущего прогона остаётся подтверждённым: 1 completion, 17 480 ms, 12 753 токена, сохранение и повторное чтение из локальной D1. Новые LLM Assisted и Compare после расширения smoke ещё не выполнены: локальная дневная защита остановила прогон до внешнего API. Это не считается inference. Финальный статус обновить после разрешённого штатного повтора.

## Финальная повторная проверка после сброса квоты — 2026-11-13

Использована модель `google/gemma-4-26b-a4b-it`; `npm run test:polza` выполнен на синтетическом демо-документе, без отправки документов корпуса.

| Режим | Результат | Latency | Usage | D1 |
|---|---|---:|---:|---|
| LLM Assisted | PASS, реальный ответ прошёл схему и grounding | 9 481 ms | 12 739 prompt + 857 completion = 13 596 | Сохранение и history readback пройдены |
| Compare | PASS, реальный ответ прошёл схему и grounding | 20 963 ms | 12 740 prompt + 1 170 completion = 13 910 | Сохранение и history readback пройдены |

Compare counts: 27 совпадений, 2 расхождения, 0 только Rules Only, 0 только LLM. Конфликты остаются `review`/`null`. Первая попытка до штатного сброса завершилась HTTP 429 `AI_DAILY_LIMIT` до вызова провайдера. Первая попытка после сброса получила успешный Assisted completion, но завершилась на ошибочной проверке поля ID истории; проверка исправлена (D1 возвращает `id`), повторный полный smoke прошёл. Обход лимита не применялся.

Итоговые повторные проверки: `npm test` PASS 47/47, `npm run test:api` PASS, `npm run test:polza` PASS, `npm run build` PASS, `npm run db:migrate:local` PASS (миграций нет), `git diff --check` PASS.
