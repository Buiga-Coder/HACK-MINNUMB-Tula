# Проект контрактов API

Версия API: /api/v1. Это проект интерфейса, а не существующий сервис. При реализации требуется машиночитаемая OpenAPI-спецификация, согласованная с этими правилами и контрактными тестами.

## 1. Общие соглашения

JSON UTF-8, GeoJSON для геометрии; UUID для внутренних идентификаторов, ISO 8601 для дат. Публичное чтение без авторизации. Административные операции — защищённая сессия и проверка роли/территории. Внешняя аутентификация заявителя определяется отдельно; произвольный токен Госуслуг не считается допустимой интеграцией.

Пагинация: page от 1, page_size по умолчанию 20, максимум 100; ответ items, page, page_size, total. Сортировка по разрешённому списку и id вторым ключом. Даты from/to включительны для календарных периодов; время хранится в UTC. Параметры неизвестных справочников → 422, а не незаметное игнорирование.

Ошибка:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Проверьте параметры запроса",
    "fields": [{"path": "minutes", "reason": "Допустимы 10 и 15"}],
    "request_id": "example-request-id"
  }
}
```

Коды: 400 — нарушен синтаксис; 401 — нет сессии; 403 — нет прав; 404 — отсутствующий или недоступный публичный объект; 409 — конфликт состояния/идемпотентности; 412 — несовпадение редакции; 413 — превышен размер; 415 — формат; 422 — семантическая проверка; 429 — лимит с Retry-After; 503 — сервис временно недоступен. Stack trace и секреты не возвращать.

GET использует ETag/If-None-Match, где применимо. PATCH/публикация требуют If-Match редакции; при отсутствии — 428. Обновления возвращают новую редакцию. POST отправки сообщений и запуска импорта принимает Idempotency-Key: одинаковый ключ и тело → тот же результат, другое тело → 409; срок технического хранения ключа не менее 24 часов. Долговременная защита от дублирования отправок обеспечивается также устойчивым ID заявки.

## 2. Публичный реестр и карта

| Метод / путь | Вход | Ответ |
|---|---|---|
| GET /reference-data | locale=ru | Версии справочников отраслей, статусов, этапов, собственности, категорий жалоб |
| GET /municipalities | boundary_version optional | Территории и версия границ |
| GET /objects | q, status, stage, sector, ownership, municipality_id, amo_id, customer_id, contractor_id, year_from/to, year_type, bbox optional, page, page_size, sort | Пагинированный список кратких карточек |
| GET /objects/{id} | — | Только опубликованная редакция, полные поля, источники и разделы |
| GET /map/features | bbox, zoom, те же фильтры | FeatureCollection объектов/кластеров, total, data_version |
| GET /objects/{id}/media | phase, kind, page | Опубликованные материалы и права |
| GET /objects/{id}/cameras | — | Доступные камеры, состояние и дата кадра без секретов |
| GET /objects/{id}/procurements | page, page_size | Подтверждённые записи с типом, источником, fetched_at и stale |

bbox: west,south,east,north. Для этого портала west < east, south < north; ограничить допустимую область запроса. Мультизначные фильтры — повтор параметра, например sector=education&sector=sport. year_type — commissioning/planned_completion; actual_completion может быть добавлен явно. Нет фильтра года — объекты с неизвестным годом не исключаются.

Ответ карты ограничивается 2000 features; при превышении сервер увеличивает агрегацию, а не молча обрезает объекты. Кластер содержит count и bounds для перехода. Фильтры списка и карты покрываются общими контрактными тестами. При дальнейшем росте допускается переход на векторные тайлы с сохранением семантики фильтров.

## 3. Геоаналитика

POST /objects/{id}/isochrones — публичная вычислительная операция с ограничением частоты. Тело:

```json
{"minutes":[10,15],"profile":"walking","scenario":"current_network"}
```

Ответ 200: FeatureCollection, properties каждой зоны содержит minutes, profile, graph_version, entrance_revision, calculated_at, is_forecast, approximate, warnings. Геометрия Polygon/MultiPolygon. Лимит 5 секунд целевой, серверный таймаут 10 секунд; при превышении — 503 с понятной причиной. NO_ROUTABLE_ENTRANCE → 422. Недопустимый сценарий → 422. Фактическая структура должна быть включена в OpenAPI при реализации.

GET /analytics/provision?sector=...&period=...&territory_level=...&scenario=... → FeatureCollection с category, ratio, capacity, population, unit, source_refs, method_version, boundary_version, quality_flag. Для no_data ratio=null и reason. Отсутствующий утверждённый расчёт → пустой слой с availability=unavailable, а не нулевые значения.

GET /analytics/satisfaction?sector=...&date_from=...&date_to=...&territory_level=... → территории, index, participation, sample_size при разрешённой публикации, method_version и suppression_reason. Подавленные значения и счётчики возвращать null; запрещено раскрывать их через соседние endpoint или произвольную детализацию.

GET /methodologies/{id}/versions/{version} → формула, определения, пороги, источники, период действия и сведения об утверждении. GET /data-sources → публичное описание источников и свежести без закрытых параметров подключения.

## 4. Обратная связь

GET /feedback/capabilities → mode (external_link/widget/integrated), official_url, supported_categories, attachment_limits, status_tracking_available. Конфигурация URL задаётся оператором и проверяется перед публикацией; пользователь не может подставить адрес назначения.

В mode=external_link/widget портал не предоставляет работающий POST отправки: возвращать 409 INTEGRATION_NOT_ENABLED, если он вызван напрямую. Ссылка не создаёт локальную запись «Отправлено».

При mode=integrated:

| Метод / путь | Контракт |
|---|---|
| POST /feedback/attachments | multipart после аутентификации, карантин; 202 с attachment_id и scan_state |
| POST /feedback/submissions | object_id nullable, point, category, description, attachment_ids, согласованные поля; 202 с local_state и tracking_available |
| GET /feedback/submissions/{id} | Только владелец; local_state, external_status, external_id если получен, updated_at |
| POST /integrations/feedback/events | Только доверенный адаптер; подпись, timestamp, event_id; защита от повтора |

202 означает принятие локальной системой в обработку. Состояния: queued → transmitting → acknowledged; при неопределённости reconciliation_pending; при подтверждённом отказе rejected. acknowledged означает подтверждение внешнего приёма, а не выполнение проблемы. Регистрационный номер может появиться позже. Внешние статусы сохраняются с исходными кодами и отдельной согласованной таблицей отображения. Повтор webhook event_id не меняет данные повторно; события вне порядка не откатывают более свежую версию.

## 5. Администрирование

| Метод / путь | Роль и результат |
|---|---|
| POST /admin/objects | Редактор своей территории; 201, черновик |
| PATCH /admin/objects/{id} | Редактор в допустимом состоянии; If-Match; новая редакция |
| POST /admin/objects/{id}/submit | Редактор; отправка на проверку |
| POST /admin/objects/{id}/publish | Модератор; валидация обязательных полей |
| POST /admin/objects/{id}/reject | Модератор; обязательная причина |
| POST /admin/objects/{id}/archive | Модератор; причина, без физического удаления |
| POST /admin/objects/{id}/restore-revision | Модератор; новая редакция на основе старой, не стирание истории |
| POST /admin/imports | Загрузка; 202 с job_id, никакой автоматической публикации |
| GET /admin/imports/{id} | Состояние и счётчики create/update/unchanged/error |
| GET /admin/imports/{id}/errors | Пагинированные ошибки строк без избыточных персональных сведений |
| POST /admin/imports/{id}/apply | Подтверждение проверенного snapshot, If-Match; 202 |
| POST /admin/procurement-links | Модератор; подтверждение связи и основание |
| GET /admin/audit | Уполномоченная роль, фильтры и пагинация |
| GET /admin/integrations/health | Администратор; статус, время, тип ошибки без секретов |

Административное управление медиа, входами, справочниками и методиками должно быть описано в OpenAPI до реализации соответствующего экрана. Публикация методики требует approved_by/approved_at и не выдаётся роли аналитика автоматически.

## 6. Ограничения и тестирование

Стартовые лимиты: публичное чтение 120 запросов/мин на IP, изохроны 10/мин на IP; значения уточнить нагрузочным тестом с учётом общих NAT. Админ-загрузки лимитируются отдельно по пользователю. Доверять X-Forwarded-For только от своего reverse proxy.

Обязательные контрактные проверки: одинаковые фильтры карты/списка; NULL и неизвестные годы; закрытые поля отсутствуют; чужая территория → 403; неактуальный If-Match → 412; дубликат отправки; неподтверждённая внешняя отправка; подавленные аналитические счётчики; неверный GeoJSON; все режимы деградации.
