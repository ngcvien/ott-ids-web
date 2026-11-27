# Nạp model GWM từ web vào lõi IDS

## Cách sử dụng

1. Commit/push bản web mới, chờ Vercel deploy thành công. Không đổi Firebase env hoặc device key. Thay đổi GWM này không cần đổi Firestore Rules; rules models/modelCommands đã triển khai vẫn dùng được.
2. Nạp sketch ESP32 mới, firmware **ott-ids-1.3.0**. Giữ nguyên Wi-Fi/key, DIO 16 MB, OPI PSRAM và partition hiện có. **Không erase/format flash.** Firmware đọc được cache model cũ và journal NVS hiện có.
3. Đăng nhập owner → **Thiết bị** (`/dashboard/devices`) → **Nạp model vào lõi IDS**.
4. Chọn `gateway24_model2_5s_v02000001.gwm`, đặt tên. Version tự đọc từ header, không nhập tay. Bấm **Kiểm tra và lưu model**.
5. Chọn phiên bản và đúng thiết bị → **Nạp model vào thiết bị**. Upload file chỉ lưu phiên bản, chưa tạo lệnh nạp.
6. Chờ ESP nhận qua heartbeat (60–65 giây); các bước mạng xử lý/retry theo nhịp 15 giây. Chỉ coi là hoàn tất khi lịch sử báo **Nạp thành công**.
7. Kiểm tra log và heartbeat: model hợp lệ, đúng version, không lỗi. `RUN_ENABLE` vẫn **0**; nếu cần enforcement, người vận hành chủ động bật tại thiết bị sau khi kiểm tra.

Gói mẫu được giữ nguyên tại `public/models/gateway24_model2_5s_v02000001.gwm` và có link tải trên giao diện. Không upload `.joblib`, bitstream hoặc firmware ESP vào mục model.

## Đặc tả đã áp dụng

Theo `README_UPLOAD_VI.md` đi kèm artifact: Gateway24 `.gwm` v1, header 80 byte; mọi số nguyên trong header **big-endian**, payload từng word 64 bit **little-endian**.

| Offset | Kích thước | Nội dung bắt buộc |
|---|---|---|
| 0 | 8 | ASCII `GW24MODL` |
| 8 | 2 | Format version = 1 |
| 10 | 2 | Header size = 80 |
| 12 | 2 | Model ABI = 1 |
| 14 | 2 | Word bits = 64 |
| 16 | 4 | Runtime version uint32 |
| 20 | 2 | Node count 1–127 |
| 22 | 2 | Feature count = 24 |
| 24 | 4 | Flow window = 5000 ms |
| 28 | 4 | Payload length = node count × 8 |
| 32 | 4 | Payload CRC-32/ISO-HDLC |
| 36 | 4 | Flags = 1 (payload word LE) |
| 40 | 32 | Payload SHA-256 dạng bytes |
| 72 | 8 | Reserved, tất cả bằng 0 |
| 80 | count × 8 | Payload |

Server và ESP từ chối file thiếu/thừa byte, quá 1096 byte, sai header/ABI/feature/window/flags/reserved, CRC hoặc SHA. CRC reflected polynomial `0xEDB88320`, init/final XOR `0xFFFFFFFF`.

| Gói mẫu | Giá trị |
|---|---|
| File size | 648 byte |
| Runtime version | `0x02000001` / `33554433` |
| Node count / payload | 71 / 568 byte |
| Payload CRC32 | `44124ea7` |
| Payload SHA-256 | `c26dd8cf58278f33fec4cc22dc4d3190ada7fc4f27aa986eb62e96e91d95dad3` |
| Artifact SHA-256 (toàn file) | `291bd477354327447258c17139ded1933f40c7dcf4afbd6a1b716eb2ed857fd1` |

SHA payload và SHA toàn artifact là hai giá trị khác nhau. SHA file ROM text cũng khác; không dùng thay thế. Checksum xác minh tính toàn vẹn, không chứng minh độ chính xác phân loại. Định dạng hiện chưa có chữ ký số; triển khai production cần bổ sung chữ ký và public key tin cậy trong firmware theo đề xuất của đặc tả.

## API, Firestore và tương thích

Owner upload `POST /api/models` bằng Firebase ID token. Body JSON gồm `orgId`, `name`, `kind: "model"`, `version` dạng số từ header, `artifact_base64` và `artifact_sha256`. Server kiểm tra lại mọi trường và checksum, không tin metadata từ trình duyệt.

Firestore `organizations/{orgId}/models/{modelId}` lưu core model chuẩn hóa để tương thích dữ liệu cũ, thêm `artifact` metadata và `artifact_base64` chứa đúng bytes file. File tối đa 1096 byte nên không cần dịch vụ lưu trữ riêng. `modelId` vẫn là SHA-256 manifest core chuẩn hóa; `modelVersions/{version}` vẫn ràng buộc một version với một nội dung trong mỗi tổ chức. Upload lại GWM trùng core/version bổ sung artifact vào bản cũ, giữ tên và ngày tạo. Nội dung thay đổi phải dùng version mới.

`POST /api/model-commands` tạo UUID v4 idempotent; ghi lịch sử tại `devices/{deviceId}/modelCommands/{commandId}` và tóm tắt `model_update`. Một thiết bị chỉ có một lệnh queued/downloading/loading. Viewer chỉ xem; mọi ghi browser trực tiếp vẫn bị rules từ chối.

Heartbeat trả `model_command: {command_id, model_id, artifact_sha256}` kể cả khi telemetry bị giới hạn ghi. ESP dùng cùng device key (`X-Device-ID`, `X-Device-Key`), POST `/api/device/model` với `{command_id}` và header `Accept: application/vnd.gateway24.model`. API trả **binary GWM nguyên vẹn**, Content-Type tương ứng, Content-Length và `X-Artifact-SHA256`; `Cache-Control: no-store`. Thiết bị chỉ tải model được gán cho command hiện hành trong đúng tổ chức, không nhận URL ngoài tùy ý.

Firmware 1.3.0 đối chiếu SHA toàn file với heartbeat và header download; sau đó kiểm header, payload CRC/SHA trước khi staging. Với command cũ chưa có SHA artifact, dùng digest trả qua HTTPS đã xác thực. API giữ JSON cũ khi client không yêu cầu binary để firmware cũ tiếp tục hoạt động; web mới chỉ cho chọn `.gwm`. Model cũ trong DB có thể tạo GWM tương đương khi firmware mới tải, không cần xóa hay upload lại toàn bộ lịch sử.

Trạng thái: `queued → downloading → loading → succeeded/failed`; cho phép hủy trước loading. ESP phải nhận server xác nhận `loading` trước khi main task nạp SPI. Thành công yêu cầu đúng version/payload SHA, model_valid=true, protocol_error=load_error=0, run_enabled=false.

## Flash, SPI và khôi phục

- HTTPS worker ghi `/models/<commandId>.bin.tmp` gồm envelope kích thước/SHA và bytes GWM, flush, đọc kiểm tra lại rồi rename. Model dùng chung LittleFS với outbox nhưng thư mục riêng; không đổi partition.
- Journal NVS `model-state` có CRC giữ command, phase, active/previous và kết quả chờ gửi. Cache binary cũ vẫn đọc được; layout NVS và `OttModelImage` giữ nguyên. Chỉ đổi active khi lõi xác nhận và journal ghi thành công; giữ previous và model compiled dự phòng.
- Main task là bên duy nhất dùng SPI. Đọc word LE thành uint64, gửi `CMD_WORD` **MSB trước**; SPI mode 0, 1 MHz, không đổi contract loader ABI 1. Không cần đổi bitstream cho model cùng contract.
- Lưu Applying trước SPI. Ready sau reboot phải xin phép server lại; Applying gián đoạn thành failed/interrupted, không tự nạp lại candidate và thử restore cache/default. Kết quả mạng mất được gửi lại, không nạp lại command đã kết thúc.
- Khi lõi mất model, `m`/auto-restore ưu tiên cache hợp lệ rồi model compiled. Nạp/commit thất bại thử ABORT và restore; xem log nếu storage hoặc phần cứng lỗi. `RUN_ENABLE` giữ 0.
- Không xóa/ACK alert để nạp model. Chọn lúc ít traffic vì queue hữu hạn. Không format flash để nâng cấp định dạng.

## Đóng gói và kiểm thử

Đã có `.gwm` thì upload trực tiếp. Nếu xuất model từ ROM text/header cũ:

```powershell
npm run model:pack -- --input D:/duong-dan/node_rom.mem --version 0x02000002 --output model-v2.gwm
```

Công cụ không ghi đè file có sẵn. `.json` chỉ giữ cho tích hợp cũ.

```powershell
npm run test:all
npm run build
```

Tests dùng emulator `demo-lastdance`, không nạp phần cứng và không ghi Firebase thật. Trên board cần thử gói mẫu, restore cache cũ/mới sau reboot, mất Wi-Fi khi tải/gửi kết quả, hủy khi downloading, reset lõi IDS và cắt nguồn lúc nạp. Xác minh alert persist/delivered vẫn hoạt động. Build/compile không thay thế kiểm thử vật lý này.
