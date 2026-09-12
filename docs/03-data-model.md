# Модель данных и правила импорта

Версия 1.0. Это целевая схема, а не описание отсутствующего исходного приложения. Фактический файл следует сохранить неизменным и сопоставить с этой схемой перед реализацией загрузчика.

## 1. Общие правила

Внутренние ID — UUID. Внешний ключ записи — пара source_id + external_id. Время — ISO 8601 с UTC в хранилище; календарные даты — date; годы — integer. Деньги — decimal(18,2), не float. Геометрия обмена — GeoJSON WGS 84, порядок координат [долгота, широта]; расстояния не рассчитываются как метры в географических градусах.

Все изменяемые сущности имеют created_at, updated_at, revision и автора изменения. Источниковые записи дополнительно имеют source_id, external_id, observed_at (дата актуальности), imported_at, is_demo. NULL означает неизвестно; ноль — достоверное нулевое значение. Справочники имеют code, title, active_from/active_to; код нельзя повторно использовать с новым смыслом.

## 2. Основная сущность construction_object

| Поле | Тип | Правило |
|---|---|---|
| id | UUID | Обязательно, неизменно |
| external_id | string ≤ 200 | Обязательно для импортируемой записи |
| name | string 1–500 | Обязательно для публикации |
| description | text ≤ 10000 | Необязательно, простой текст |
| address | string ≤ 1000 | Обязательно для публикации |
| point | Point | Обязательно для карты после проверки |
| footprint | Polygon/MultiPolygon | Необязательно, контур объекта |
| coordinate_quality | enum | verified / geocoded / approximate |
| municipality_id | UUID | Обязательно; территория относится к версии границ |
| amo_organization_id | UUID nullable | До подтверждения смысла АМО допустим NULL |
| amo_source_value | string nullable | Сохранённое исходное значение АМО |
| sector_code | reference | Обязательно; основной отраслевой код |
| stage_code | reference | Обязательно; этап работ |
| status_code | reference | planned / building / suspended / completed / commissioned / cancelled |
| ownership_code | reference | federal / regional / municipal / private / other / unknown |
| planned_completion_year | integer nullable | Плановое завершение работ |
| actual_completion_year | integer nullable | Фактическое завершение работ |
| commissioning_year | integer nullable | Только фактический ввод |
| commissioning_date | date nullable | Заполняется при наличии точной даты |
| commissioning_evidence | string nullable | Документ или источник подтверждения ввода |
| lifecycle_state | enum | draft / review / published / archived |
| source_id | UUID | Обязательный источник |
| observed_at | date | Обязательная дата актуальности сведений |
| is_demo | boolean | Обязательно, false не подставлять для тестовых данных |

Заказчики и подрядчики вынесены в object_organization, поскольку их может быть несколько. Неизвестный подрядчик не препятствует публикации объекта, но фиксируется в отчёте полноты.

Валидация: дата ввода и год согласованы; фактический ввод не в будущем относительно даты проверки; статус commissioned требует подтверждённого года/даты и источника ввода. Плановый год допускается в будущем. При конфликте этапа и статуса запись отправляется на проверку, а не исправляется автоматически. Точное множество допустимых пар этап/статус согласовать со справочником заказчика.

Точка вне границ региона/муниципалитета — ошибка контроля, допускающая мотивированное решение модератора для пограничных объектов. Переставленные координаты не исправлять незаметно. При отсутствии координат объект остаётся черновиком до геокодирования/ручного выбора.

## 3. Связанные сущности

| Сущность | Основные поля и связи |
|---|---|
| municipality | id, code, name, type, boundary_version_id, geometry, valid_from/to |
| territory | id, parent_id, level, boundary_version_id, geometry; микрорайоны только из согласованного источника |
| organization | id, name, идентификатор источника, ИНН/КПП при наличии; физлица не добавляются как публичные контакты |
| object_organization | object_id, organization_id, role (customer/contractor/owner/amo), valid_from/to |
| entrance | id, object_id, point, public_access, active_from/to, accessibility_status, source_id |
| capacity | id, object_id, metric_code, value decimal ≥ 0, unit_code, population_group, effective_from/to, scenario_id |
| source | id, name, url, owner, access_mode, license_note, update_interval, last_success_at |
| object_revision | id, object_id, revision, snapshot, state, author_id, reviewer_id, reason, published_at |
| audit_event | id, actor_id, entity_type/id, action, field_diff, timestamp, request_id |

Мощности имеют отраслевые единицы: места, посещения/смену и другие утверждённые показатели. Нельзя суммировать разные единицы. Объект с несколькими отраслями получает отдельные записи мощности, но основной сектор карточки остаётся определённым.

## 4. Медиа и закупки

media_asset: id, object_id, phase (before/during/after), kind (photo/video/raster/render/document), captured_at nullable, captured_year nullable, date_precision (day/month/year/unknown), title, storage_key или разрешённый source_url, geometry nullable, bounds nullable, rights_note, source_id, is_actual, moderation_state, checksum. Для таймлапса нужна известная дата хотя бы до года; unknown-материалы доступны отдельно. Для month хранить также месяц, без фиктивного дня.

camera: id, object_id, title, secret_reference, gateway_path, permission_valid_to, enabled, last_frame_at, health_status. Исходные credentials доступны только шлюзу; публичный API camera не сериализует secret_reference.

procurement_record: id, source_id, external_id, record_type (notice/price_request/contract), number, title, source_status, normalized_status nullable, amount nullable, currency, signed_at nullable, planned_end_at nullable, actual_end_at nullable, source_url, observed_at, fetched_at, revision. История изменений — procurement_revision.

object_procurement: object_id, procurement_id, match_method (external_id/manual), confirmed_by, confirmed_at, allocated_amount nullable. Сумма распределений не больше стоимости контракта, если распределения заданы; неполное распределение явно маркируется. Кандидаты нечётких совпадений хранятся отдельно и не показываются как подтверждённые контракты.

## 5. Аналитические сущности

population_observation: territory_id, boundary_version_id, period_start/end, population_group, count, population_type (resident/present), source_id, methodology_version, quality_flag.

methodology: id, version, sector, metric_code, formula_definition, norm_value, norm_unit, thresholds, population_group, approved_by, approved_at, effective_from/to. Черновая методика не публикуется как официальная.

analytics_run: id, method_id/version, input_dataset_versions, scenario_id, calculated_at, publication_state, error_report. Исходные версии фиксируются полностью.

provision_aggregate: run_id, territory_id, boundary_version_id, capacity, population, norm, ratio nullable, category (low/normal/high/no_data), quality_flag, suppression_reason nullable.

satisfaction_aggregate: run_id, territory_id, sector, period_start/end, eligible_answers_count, rated_answers_count, positive_count, index nullable, participation nullable, suppression_reason. Публичная проекция для подавленных ячеек не отдаёт точные счётчики.

isochrone_cache: object_id, entrance_revision, graph_version, profile, duration_seconds, scenario_id, geometry, calculated_at, expires_at. Кэш — производные данные, восстановление возможно перерасчётом.

## 6. Обращения: условный закрытый модуль

В режиме внешней ссылки эти таблицы не заполняются. Полный модуль вводится после согласования интеграции.

feedback_submission: id, owner_subject_id, object_id nullable, point, category, description_encrypted, attachment_refs, consent_record nullable согласно утверждённой схеме, local_state, external_id nullable, external_status nullable, idempotency_key, created_at, retention_until. Контакты — отдельное защищённое хранилище при необходимости; публичной связи с агрегатами нет.

feedback_delivery: submission_id, attempt_id, request_checksum, sent_at, acknowledgement_at, outcome, reconciliation_state. Не сохранять тела с персональными данными в техническом журнале.

## 7. Импорт и маппинг исходного приложения

| Поле из задания | Целевое поле | Преобразование |
|---|---|---|
| Наименование ОКС | name | trim, сохранение полного названия |
| Этап строительства | stage_code | Явная таблица соответствий |
| Адрес | address | Сохранить оригинал, нормализация отдельно |
| Отрасль | sector_code | Согласованный справочник |
| Статус | status_code | Не выводить автоматически из этапа |
| Собственность | ownership_code | Неизвестное → unknown с исходным значением в пакете |
| АМО | amo_source_value / amo_organization_id | После подтверждения расшифровки |
| Заказчик / подрядчик | organization + object_organization | Роли не смешивать, не объединять только по похожему названию |
| Год ввода/окончания | отдельные year-поля | Не разбирать неоднозначное значение без правила заказчика |

DATA-05. Для каждого пакета сохранять имя, sha256, источник, дату, размер, число строк, версию маппинга и автора. Ограничение первой версии — 20 МБ или 50 000 строк; превышение возвращает понятную ошибку до обработки.

DATA-06. Контроль: обязательные поля, кодировка UTF-8 для CSV, уникальность source_id/external_id, справочники, координаты, даты, ссылки и дубли. CSV-формулы при последующих выгрузках экранировать; макросы и внешние связи файлов не исполнять.

DATA-07. В preview показывать create/update/unchanged/error и изменённые поля. Повтор одинакового checksum возвращает прежний результат либо безопасный no-op. Обновление применяется по external_id, не по номеру строки. Для источников без ID сначала утверждается устойчивый ключ; название+адрес служит кандидатом, не окончательной идентичностью.

DATA-08. Исчезновение объекта из нового файла создаёт предупреждение, не удаление. Исправления модератора защищаются от безусловного перезаписывания следующим импортом; конфликт идёт на согласование.

## 8. Синтетическая запись для разработки

Пример не описывает реальный объект Тульской области. Координата предназначена только для проверки формата; географическая принадлежность должна проверяться по фактическим границам.

```json
{
  "external_id": "DEMO-001",
  "name": "Демонстрационный объект образования",
  "address": "Учебный адрес, не реальный объект",
  "point": {"type": "Point", "coordinates": [37.62, 54.19]},
  "sector_code": "education",
  "stage_code": "construction",
  "status_code": "building",
  "ownership_code": "unknown",
  "planned_completion_year": 2027,
  "commissioning_year": null,
  "lifecycle_state": "draft",
  "observed_at": "2026-09-12",
  "is_demo": true
}
```

Это фрагмент, а не валидный запрос публикации: отсутствующие source_id и municipality_id назначаются из тестовых справочников. Полный реальный образец импорта создаётся после получения исходного приложения.
