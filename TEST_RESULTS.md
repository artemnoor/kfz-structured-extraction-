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
