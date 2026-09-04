# ImageProxyService — подробная документация (все файлы)

Микросервис фоновой обработки изображений: генерирует превью, среднеразмерные версии и circle-аватары из оригиналов, загруженных через `MediaService`, используя MinIO/S3 как хранилище объектов и `sharp` для обработки изображений. Собственной базы данных не имеет — состояние не хранится, сервис полностью event-driven (только слушает и публикует сообщения RabbitMQ).

---

## 1. Дерево модуля

```
src/
├── main.ts
├── app.module.ts / app.controller.ts / app.service.ts
└── modules/
    ├── image-processor/
    │   ├── image-processor.module.ts
    │   ├── image-processor.controller.ts   — событие file.uploaded
    │   └── image-processor.service.ts      — обработка через sharp
    └── s3/
        ├── s3.module.ts
        └── s3.service.ts                   — обёртка над MinIO/S3
```

---

## 2. `main.ts` — точка входа

- **Не поднимает HTTP REST для бизнес-логики** — `app.listen` вызывается (порт `PORT`, по умолчанию `3005`), но реального REST API для клиентов у сервиса нет (`AppController` содержит только служебный `GET /`).
- Основной транспорт — RabbitMQ-консьюмер: `Transport.RMQ`, очередь `media_events` (durable), слушает событие `file.uploaded`.
- Сервис полностью асинхронный: клиенты никогда не обращаются к нему напрямую, вся работа инициируется событием из очереди.

## 3. `app.module.ts`

Импортирует `ConfigModule` (global) и `ImageProcessorModule`. Больше ничего — минималистичный корневой модуль.

## 4. `modules/s3/` — `S3Service`, `S3Module`

Обёртка над AWS SDK v3 (`@aws-sdk/client-s3`), настроена на MinIO (`forcePathStyle: true`, кастомный `endpoint`).

| Метод | Назначение |
|---|---|
| `getUploadUrl(objectKey, mimeType)` | presigned URL для `PUT`, TTL 300 сек (не используется в этом сервисе напрямую — метод, вероятно, скопирован из `MediaService`, где он реально нужен для запроса на загрузку) |
| `checkObjectExists(objectKey)` | `HeadObjectCommand`, возвращает `{ exists, sizeBytes }` |
| `downloadObject(objectKey)` | скачивает объект целиком в `Buffer` (стримом, через асинхронную итерацию по `Readable`) |
| `uploadBuffer(objectKey, buffer, mimeType, bucket?)` | загружает готовый буфер; необязательный параметр `bucket` позволяет писать в **другой** бакет, чем основной (используется для аватаров — см. `image-processor.service.ts`) |
| `getDownloadUrl(objectKey)` | presigned URL для `GET`, TTL 3600 сек (тоже не используется здесь напрямую — этот сервис публикует только **ключи** объектов, а не готовые URL, см. раздел 6) |

Конфигурация — `MINIO_BUCKET`, `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY` (все — `getOrThrow`, обязательны).

**Замечание:** методы `getUploadUrl` и `getDownloadUrl` присутствуют в коде, но фактически не вызываются из `ImageProcessorService` в предоставленных файлах — вероятно, класс `S3Service` скопирован «как есть» из `MediaService` (файлы идентичны по структуре), а не написан заново под нужды именно этого сервиса, что оставляет неиспользуемый код.

## 5. `modules/image-processor/image-processor.module.ts`

Импортирует `S3Module`, регистрирует `ClientsModule` под именем `MEDIA_PROCESSING_SERVICE` (транспорт `RMQ`, очередь `media_processing_events`, durable) — это **исходящий** канал, в который сервис публикует результат обработки. Providers: `ImageProcessorService`. Controllers: `ImageProcessorController`.

## 6. `modules/image-processor/image-processor.controller.ts` — обработчик события `file.uploaded`

```ts
interface FileUploadedEvent {
  mediaId: string;
  uploaderId: string;
  url: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  objectKey: string;
  purpose?: 'attachment' | 'avatar';
  crop?: { x: number; y: number; size: number } | null;
}

@EventPattern('file.uploaded')
async handleFileUploaded(@Payload() event: FileUploadedEvent) { ... }
```

**Логика:**
1. Если `mimeType` не начинается с `image/` — сообщение игнорируется (лог `Пропускаем {mediaId} — не изображение`). То есть видео/PDF и прочие типы, которые `MediaService` тоже пропускает через тот же поток `file.uploaded`, здесь просто отбрасываются без какой-либо обработки — для них никакие «варианты» (`variants`) не создаются.
2. Если `event.purpose === 'avatar'`:
   - требует наличие `event.crop` — если его нет, предупреждение в лог и выход без обработки (аватар без параметров обрезки не может быть обработан этим путём);
   - иначе вызывает `imageProcessorService.processAvatar({ mediaId, objectKey, crop })`.
3. Иначе (обычное вложение, `purpose` не задан или `'attachment'`) — вызывает `imageProcessorService.processImage(event)`.

## 7. `modules/image-processor/image-processor.service.ts` — обработка через `sharp`

### 7.1. `processImage(event: { mediaId, objectKey, mimeType })`
1. Скачивает оригинал из S3/MinIO (`s3Service.downloadObject`).
2. Генерирует `placeholder` — крошечное блюр-превью в base64 (`generatePlaceholder`, см. ниже) для мгновенного отображения на фронтенде, пока основное изображение грузится (LQIP-паттерн, low-quality image placeholder).
3. Генерирует **thumbnail** — 200×200, `fit: 'cover'` (обрезка под квадрат), JPEG качество 80.
4. Генерирует **medium** — вписывается в 800×800 без увеличения (`fit: 'inside', withoutEnlargement: true`), JPEG качество 85.
5. Формирует ключи для новых объектов заменой расширения исходного `objectKey` на `_thumb.jpg` / `_medium.jpg` (регулярка `/(\.\w+)$/`).
6. Загружает оба варианта в тот же (основной) бакет через `uploadBuffer`.
7. Публикует `rabbitClient.emit('image.processed', { mediaId, variants: { thumbnail, medium, placeholder } })` в очередь `media_processing_events`.
8. Ошибки перехватываются `try/catch` и только логируются (`logger.error`) — сообщение из очереди при этом считается успешно обработанным (RabbitMQ ack происходит на уровне транспорта Nest по умолчанию для `@EventPattern`), то есть **при сбое обработки повторной попытки не будет**, а событие `image.processed` просто не будет опубликовано — файл в `MediaService` навсегда останется без `variants`.

### 7.2. `processAvatar(event: { mediaId, objectKey, crop: { x, y, size } })`
1. Скачивает оригинал, генерирует `placeholder` тем же способом.
2. Обрезает квадратную область по координатам `crop` (`sharp().extract({ left: x, top: y, width: size, height: size })`), масштабирует к 512×512.
3. Накладывает круглую SVG-маску (`<circle cx="256" cy="256" r="256"/>`) через `composite([{ input: circleMask, blend: 'dest-in' }])` — получает **круглый** PNG-аватар с прозрачным фоном за пределами круга.
4. Ключ нового объекта — замена расширения на `_avatar.png`.
5. Загружает результат **в отдельный бакет** — `AVATAR_BUCKET` (обязательная переменная окружения, отдельная от основного `MINIO_BUCKET`) — то есть аватары физически хранятся в другом бакете, нежели обычные вложения.
6. Публикует `image.processed` с `variants: { avatar, placeholder }`.
7. Ошибки — аналогично `processImage`, только логируются.

### 7.3. `generatePlaceholder(original: Buffer): Promise<string>`
Уменьшает изображение до ширины 20px, применяет `blur(2)`, кодирует в JPEG качества 30, возвращает data URL (`data:image/jpeg;base64,...`) — классический приём для мгновенного LQIP-превью на клиенте до загрузки полноразмерного изображения.

---

## 8. Интеграции — сводная таблица

| Канал | Направление | Партнёр | Событие/данные |
|---|---|---|---|
| RabbitMQ (`media_events`) | слушает | `MediaService` | `file.uploaded` — сигнал о подтверждённой загрузке файла |
| RabbitMQ (`media_processing_events`) | публикует | `MediaService` | `image.processed` — сгенерированные варианты (`thumbnail`, `medium`, `avatar`, `placeholder`) |
| S3/MinIO (основной бакет `MINIO_BUCKET`) | чтение/запись | — | оригиналы (чтение), `thumbnail`/`medium` (запись) |
| S3/MinIO (`AVATAR_BUCKET`) | запись | — | круглые PNG-аватары |

Сервис не имеет собственного REST API, gRPC-интерфейса или базы данных — вся работа опосредована двумя очередями RabbitMQ и объектным хранилищем.

---

## 9. Сводные замечания

1. **Ошибки обработки изображения не приводят к повторной попытке и не сигнализируют явно об отказе** — только логируются (`logger.error`), событие `file.uploaded` считается обработанным. Медиафайл в `MediaService` в этом случае навсегда останется без `variants` без какого-либо уведомления или retry-механизма (dead-letter очередь для `media_events` в конфигурации не настроена).
2. **Неиспользуемый код в `S3Service`** — методы `getUploadUrl`/`getDownloadUrl` присутствуют, но нигде не вызываются в этом сервисе (файл, по всей видимости, скопирован из `MediaService`).
3. **Не-изображения из `file.uploaded` просто отбрасываются без явного лога уровня `warn`/`error`** (используется `logger.log`, обычный информационный уровень) — если ожидается, что `media_events` в перспективе будет использоваться и для видео/аудио-обработки другим сервисом, тихое игнорирование здесь не проблема; если нет — стоит рассмотреть, не следует ли `MediaService` изначально не публиковать `file.uploaded` для неизображений в эту конкретную очередь.
4. **Аватары и обычные вложения физически лежат в разных S3-бакетах**, но это неявно — знание об `AVATAR_BUCKET` разбросано между `MediaService` (эмитит `crop`) и данным сервисом (читает `AVATAR_BUCKET` из конфигурации и сам решает, куда писать) — при этом `MediaService.saveVariants` затем формирует итоговый URL аватара с захардкоженным адресом `http://localhost:9000/chat-alpha-avatars/...` (см. документацию `MediaService`), что подразумевает, что имя бакета `chat-alpha-avatars` должно совпадать со значением `AVATAR_BUCKET` — эта связь нигде не выражена явно (не через общую константу/конфигурацию), что делает её хрупкой при переименовании бакета.
5. **`localDataCenter`-подобных «магических» захардкоженных значений здесь нет**, но `region: 'us-east-1'` в `S3Service` (унаследовано от `MediaService`) — условность для совместимости с AWS SDK при работе с MinIO, реального значения не имеет.
