# ImageProxyService

Обработка изображений платформы **Tapik**: превью, миниатюры и аватары с обрезкой в круг. Чистый RabbitMQ-consumer/producer, HTTP не выставляет — работает исключительно по событиям.

## Роль в системе

```
MediaService ──file.uploaded (RMQ)──▶ ImageProxyService ──image.processed (RMQ)──▶ MediaService
                                              │
                                     скачивает/загружает
                                              ▼
                                            MinIO
```

## Технологии

- **NestJS 11**, микросервисное приложение (только RabbitMQ, без HTTP-роутов)
- **sharp** — ресайз, обрезка, композиция, генерация blur-плейсхолдера
- **S3-совместимое хранилище** (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) — MinIO
- Path-алиасы: `@modules/*`

## Возможности

- Для обычных изображений: миниатюра 200×200 (`cover`), средний вариант до 800×800 (`inside`, без увеличения), blur-плейсхолдер (base64 data URL, 20px).
- Для аватаров: обрезка по присланному прямоугольнику, ресайз до 512×512, круглая маска (SVG composite `dest-in`), загрузка в отдельный бакет.
- Гейт по размеру файла (`MAX_IMAGE_BYTES`, по умолчанию 25MB) — событие с превышением просто пропускается, до `sharp()` дело не доходит.
- Ограниченная конкурентность обработки (`prefetchCount` в RabbitMQ) — не даёт бесконтрольно расти числу параллельных декодирований в памяти.
- Валидация прямоугольника обрезки (целые неотрицательные координаты, положительный размер) до вызова `sharp.extract()`.
- Защита от path traversal во входящем `objectKey` (`..`, ведущий `/`).
- Ошибка обработки одного события изолирована — не роняет consumer, только логируется.

## Потребляемое событие: `file.uploaded`

Очередь `media_events`, публикует MediaService. Обрабатывается только если `mimeType` начинается с `image/`, размер и `objectKey` проходят проверку.

```json
{
  "mediaId": "uuid", "objectKey": "u1/uuid.png", "mimeType": "image/png",
  "sizeBytes": 204800, "purpose": "attachment"
}
```

Для `purpose: "avatar"` обязательно поле `crop: { x, y, size }` — без него событие пропускается.

## Публикуемое событие: `image.processed`

Очередь `media_processing_events`, слушает MediaService.

```json
{ "mediaId": "uuid", "variants": { "thumbnail": "u1/uuid_thumb.jpg", "medium": "u1/uuid_medium.jpg", "placeholder": "data:image/jpeg;base64,..." } }
```
Для аватара — `variants.avatar` вместо `thumbnail`/`medium`.

## Переменные окружения

| Переменная | Обязательна | Назначение |
|---|---|---|
| `PORT` | нет (3005) | Технический (HTTP-роутов нет, только health) |
| `RABBITMQ_URL` | да | AMQP, очередь `media_events` |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | да | S3-совместимое хранилище |
| `MINIO_BUCKET` | да | Бакет-источник (оригиналы) и для thumbnail/medium |
| `AVATAR_BUCKET` | да | Бакет для готовых аватаров |
| `MAX_IMAGE_BYTES` | нет (25MB) | Максимальный размер изображения перед декодированием |
| `RMQ_PREFETCH_COUNT` | нет (5) | Сколько событий обрабатывать параллельно |

## Структура проекта

```
src/
├── main.ts                    # RMQ-only bootstrap
└── modules/
    ├── s3/                     # S3Service (download, upload, presign)
    └── image-processor/
        ├── image-processor.controller.ts   # file.uploaded consumer + гейты
        ├── image-processor.service.ts       # sharp-пайплайны
        └── processing-limits.ts             # MAX_IMAGE_BYTES
```

## Запуск

```bash
npm install

npm run start:dev
npm run build && npm run start:prod
npm run test
npm run lint
```

## Безопасность и надёжность

- Размер изображения проверяется до передачи в `sharp()` — раньше `sizeBytes` было объявлено в событии, но нигде не проверялось.
- `objectKey` санитизируется от path traversal перед использованием как S3-ключ.
- Прямоугольник обрезки аватара валидируется явно, а не полагается на то, что `sharp.extract()` сам бросит понятную ошибку.
