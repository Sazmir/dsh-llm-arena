# dsh-llm-arena

[English](README.md) | Русский

Bundle-провайдер Arena API для DeepSeek Harness: маршрутизация через OpenAI Responses, компактный каталог из шести моделей, аддитивное восстановление маршрута во время выполнения и узкий Windows fallback для совместимости с Cloudflare.

> [!WARNING]
> Каждый запрос к модели передаёт Arena содержимое диалога, включая промпты, системные инструкции, схемы и результаты инструментов и вложения; данные также могут попасть выбранному Arena поставщику модели. Запросы, повторы и повторная отправка через fallback могут списывать кредиты. Установка, `dsh --profile web --dump-config`, `npm test` и `npm run verify` не вызывают модели. Необязательная живая проверка потенциально платная и требует явного согласия.

## Требования

- DeepSeek Harness `0.2.0-rc.2`
- Node.js 22 или новее
- Ключ Arena API
- PowerShell 7 (`pwsh`) только при необходимости Windows fallback

Другие версии DSH могут работать, но совместимость с ними не заявляется до отдельной проверки.

## Что добавляет bundle

- Идентификатор провайдера: `arena`
- Протокол: `openai-responses` (не Chat Completions)
- Base URL: `https://api.arena.ai/v1`
- Ссылка на учётные данные: `ARENA_API_KEY`
- Шесть заранее настроенных идентификаторов моделей
- Аддитивное восстановление отсутствующего маршрута Arena в памяти после profile overrides
- Native-first Windows fallback для строго распознанной блок-страницы Cloudflare

Для моделей, точные лимиты которых публично не подтверждены Arena, bundle использует консервативные fallback-значения: контекст 262 144 токена, вывод 32 768 токенов и текстовый ввод. Для `coding-router-preview` указаны документированные метаданные: контекст 1 000 000, вывод 128 000 и ввод text/image. Это значения каталога bundle, а не гарантия upstream-сервиса.

## Модели по умолчанию

| Model id | Отображаемое имя | Примечание о доступе |
| --- | --- | --- |
| `coding-router-preview` | Arena Coding Router | Router-oriented preview |
| `claude-coding-router-preview` | Arena Claude Coding Router | Router-oriented preview |
| `claude-fable-5-1` | Claude Fable 5.1 | Прямой выбор; могут требоваться all-model credits |
| `claude-opus-5-5` | Claude Opus 5.5 | Прямой выбор; могут требоваться all-model credits |
| `claude-sonnet-5-5` | Claude Sonnet 5.5 | Прямой выбор; могут требоваться all-model credits |
| `claude-haiku-5-5` | Claude Haiku 5.5 | Прямой выбор; могут требоваться all-model credits |

Наличие записи в каталоге не гарантирует доступ аккаунта, текущую доступность, цену, rate limits или лимиты модели. Проверяйте актуальные данные в Arena dashboard своего аккаунта.

## Установка

Предпочтительно устанавливать по release tag:

```sh
dsh plugin --profile web add github:Sazmir/dsh-llm-arena#v0.1.0
dsh --profile web --dump-config
dsh web
```

`--dump-config` только проверяет композицию и не отправляет запрос провайдеру. Убедитесь, что в выводе есть строка `llm-arena`. После установки пакета перезапустите существующий DSH Web Host, обновите страницу и проверьте, что **Arena API** и шесть моделей появились в model picker.

Для разработки можно устанавливать ветку `main`:

```sh
dsh plugin --profile web add github:Sazmir/dsh-llm-arena
```

## Настройка ключа

Предпочтительный способ:

1. Откройте DSH Web → Settings → Models.
2. Выберите **Arena API**.
3. Введите ключ Arena API и примените изменение.

DSH сохраняет значение под ссылкой на учётные данные `ARENA_API_KEY`; конфигурация bundle содержит только имя этой ссылки.

Альтернативное окружение запуска в Windows:

```powershell
$env:ARENA_API_KEY = Read-Host "Arena API key" -MaskInput
dsh web
```

Альтернатива для POSIX:

```sh
read -rsp 'Arena API key: ' ARENA_API_KEY; echo
export ARENA_API_KEY
dsh web
```

Не помещайте буквальное значение ключа в `cordis.patch.yml`, custom headers, аргументы командной строки, примеры, скриншоты или логи.

## Fallback для совместимости с Cloudflare

В режиме auto каждый запрос Arena сначала использует Fetch, уже установленный DSH.

Только в Windows bundle рассматривает fallback, когда точный канонический origin `https://api.arena.ai` одновременно возвращает:

- HTTP `403`;
- HTML content;
- `server: cloudflare`;
- непустой заголовок `cf-ray`;
- известный маркер блок-страницы Cloudflare в ограниченном префиксе body.

Только затронутый запрос один раз повторяется через локальный неинтерактивный helper на PowerShell 7/.NET HttpClient. Следующий запрос снова начинается с native Fetch. Обычные ответы аутентификации, авторизации, приложения, квоты и rate limit не активируют fallback. Ошибки native network не повторяются. Все origin, кроме Arena, передаются без изменений, а macOS/Linux используют только native transport.

Граница безопасности fallback:

- URL, method, headers и body, включая authorization, попадают локальному helper через stdin и память процесса, но не через аргументы командной строки или временные request-файлы.
- Helper получает allowlist переменных окружения вместо полного окружения родительского процесса.
- Redirects отключены и завершаются ошибкой.
- Проверка TLS остаётся включённой.
- Gzip, deflate и Brotli распаковываются средствами .NET.
- SSE bytes передаются через stdout с cancellation и Node backpressure.
- Request body ограничен 64 МиБ.
- Повторная отправка означает, что exactly-once delivery не гарантируется.

## Восстановление маршрута во время выполнения

Слои profile и bundle в DSH могут заменять всю карту `llm-pi-ai.providers`. Поэтому статический bundle patch мог бы удалить провайдеры из более ранних слоёв.

Этот bundle вставляет только runtime plugin. Во время разрешения конфигурации он добавляет маршрут `arena` по умолчанию только при его отсутствии. Остальные провайдеры сохраняются, явно заданный пользователем маршрут `arena` остаётся без изменений, некорректная карта провайдеров не переписывается, profile-файлы на диске не изменяются.

## Разработка и offline-проверка

```sh
git clone https://github.com/Sazmir/dsh-llm-arena.git
cd dsh-llm-arena
npm ci
npm run verify
```

`npm run verify`, CI и обычная агентная проверка выполняют syntax checks, offline/mock tests, hygiene checks и dry-run npm-пакета. Они не вызывают Arena или другие model API независимо от наличия ключей в окружении.

### Необязательная живая проверка

Это отдельный, явно разрешённый и потенциально платный запрос. Не запускайте его в CI или при обычной агентной проверке.

PowerShell:

```powershell
$env:ARENA_LIVE_SMOKE = "1"
$env:ARENA_API_KEY = Read-Host "Arena API key" -MaskInput
npm run test:live
```

POSIX:

```sh
read -rsp 'Arena API key: ' ARENA_API_KEY; echo
ARENA_LIVE_SMOKE=1 ARENA_API_KEY="$ARENA_API_KEY" npm run test:live
```

Скрипт отказывается работать, если одновременно не заданы `ARENA_LIVE_SMOKE=1` и ключ в окружении. Он никогда автоматически не читает credential-файлы DSH.

## Устранение проблем

- **Arena API отсутствует в picker:** проверьте DSH `0.2.0-rc.2`, найдите `llm-arena` в `--dump-config`, перезапустите существующий Host и обновите страницу.
- **`MISSING_CREDENTIAL`:** настройте ссылку `ARENA_API_KEY` или окружение запуска.
- **Обычный `401` или JSON `403`:** проверьте ключ, workspace и права аккаунта; такие ответы не активируют fallback.
- **Распознанная блокировка Cloudflare в Windows, но fallback не работает:** установите PowerShell 7 и убедитесь, что `pwsh` доступен через `PATH`.
- **Прямая модель возвращает ошибку доступа или credits:** проверьте all-model access и текущий баланс аккаунта Arena.
- **Rate или quota error:** проверьте Arena dashboard; bundle не изменяет лимиты аккаунта.

## Удаление

```sh
dsh plugin --profile web remove dsh-llm-arena
```

Удаление bundle не обязательно удаляет или отзывает ключ Arena, сохранённый DSH. При необходимости удалите или замените его отдельно.

## Безопасность и лицензия

Правила приватного сообщения об уязвимостях и границы доверия описаны в [SECURITY.md](SECURITY.md).

Лицензия MIT. См. [LICENSE](LICENSE).
