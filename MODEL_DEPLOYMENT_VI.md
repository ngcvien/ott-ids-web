# Nạp model từ web vào FPGA

## Upload trực tiếp .mem

Đăng nhập owner → Thiết bị → Nạp model vào FPGA. Chọn file `.mem`, nhập tên và
**Version · ABI 1** (ví dụ `0x02000002` hoặc `33554434`), bấm **Kiểm tra và lưu model**.
Server đọc mỗi dòng một word hex 16 ký tự (1–127 node), tự tính CRC32/SHA-256 và
đóng gói nội bộ; không cần chuyển file bằng terminal. Hỗ trợ dòng trống, BOM, CRLF
và comment `//`; không nhận address directive `@...` hoặc word sai độ dài.
Sau đó chọn thiết bị và bấm **Nạp model vào thiết bị**. Upload không tự nạp FPGA.
JSON đóng gói vẫn được hỗ trợ và dùng version trong file. Hai cách có cùng quy tắc
phân quyền và ràng buộc version: cùng nội dung/version là trùng; khác nội dung phải đổi version.

## Đưa vào sử dụng

1. Trong `web`, commit/push bản web mới để Vercel deploy. Không đổi Firebase env hoặc device key.
2. Deploy Firestore Rules mới: `npm run firebase:rules -- --project ott-ids` (đăng nhập Firebase CLI nếu cần). Rules cho phép thành viên đọc models/modelCommands, nhưng mọi ghi vẫn chỉ qua API server.
3. Nạp lại sketch ESP32 với firmware **ott-ids-1.2.0**, giữ nguyên Wi-Fi/key, DIO 16 MB/OPI PSRAM và partition hiện có. Không erase/format flash. Upload firmware không tự tải hay nạp model từ cloud.
4. Đăng nhập owner, mở **Thiết bị** (`/dashboard/devices`). Trong phần **Nạp model vào FPGA**, tải gói mẫu hoặc gói tự đóng, chọn tên và bấm **Kiểm tra và lưu model**.
5. Chọn model và đúng thiết bị, bấm **Nạp model vào thiết bị**, đọc xác nhận rồi thực hiện. Khi online, ESP nhận ở kỳ heartbeat tiếp theo (60–65 giây); mỗi bước mạng còn có nhịp xử lý/retry 15 giây. Chờ lịch sử báo thành công, không coi trạng thái `loading` là thành công.
6. Kiểm tra log SPI/version và heartbeat FPGA. `RUN_ENABLE` vẫn **0**. Nếu cần enforcement, người vận hành chủ động gửi lệnh Serial `1` sau khi kiểm tra; web không tự bật lại.

## Gói model

Chỉ hỗ trợ mô hình word ROM ABI 1, **1–127 node**, mỗi node 64 bit. Không phải nạp bitstream FPGA, firmware ESP hoặc tự huấn luyện model.

```powershell
# Chạy trong web. Output phải là file mới để tránh ghi đè nhầm.
npm run model:pack -- --input ../esp32_arduino_pin_bringup/gateway24_model_generated.h --version 0x02000001 --output gateway24.json
# Với ROM khác: file .mem có đúng một word hex 16 ký tự mỗi dòng.
npm run model:pack -- --input D:/duong-dan/node_rom.mem --version 0x02000002 --output model-v2.json
```

```json
{
  "format": "ott-ids-model",
  "abi": 1,
  "version": 33554433,
  "node_count": 71,
  "words": ["<mỗi word là chuỗi hex 16 ký tự; phải đủ 71 word>"],
  "crc32": "44124ea7",
  "sha256": "<64 ký tự hex do công cụ tính>"
}
```

Ví dụ trên mô tả schema, không phải file dùng để upload. Gói đầy đủ tại `public/models/gateway24-model2.json`.
Version là uint32, không phải chuỗi; words luôn là chuỗi để không mất chính xác 64 bit.
CRC32 và SHA-256 tính trên **binary little-endian của từng word theo thứ tự node**.
SPI lại truyền mỗi word theo MSB trước, đúng contract FPGA hiện tại. SHA này khác
`GATEWAY24_MODEL_ROM_SHA256` cũ vốn gắn với artifact ROM, không dùng lẫn hai giá trị.
Một version trong cùng tổ chức không được gán cho nội dung khác. Muốn sửa model phải dùng version mới;
có thể chọn lại một version cũ đã lưu để rollback có chủ ý. Kiểm tra checksum/ABI không chứng minh
model được huấn luyện đúng hoặc cây có độ chính xác mong muốn; thử trước bằng model đã xác minh.

## Luồng và dữ liệu

Owner → `POST /api/models` (Firebase ID token) → kiểm tra owner/format/ABI/count/CRC/SHA →
Firestore `organizations/{orgId}/models/{modelId}`. `modelId` là SHA-256 manifest chuẩn hóa.
`modelVersions/{version}` giữ ràng buộc bất biến và không đọc được từ browser.

`POST /api/model-commands` tạo UUID v4 command idempotent, lưu lịch sử tại
`organizations/{orgId}/devices/{deviceId}/modelCommands/{commandId}` và tóm tắt
`model_update` trên device. API từ chối nếu thiết bị đã có lệnh queued/downloading/loading.
Viewer chỉ xem. Thiết bị offline nhận lệnh khi kết nối lại; lệnh không tự hết hạn.

Heartbeat trả thêm `model_command: {command_id, model_id}` ngay cả khi lượt ghi telemetry bị giới hạn.
ESP dùng cùng device key POST `/api/device/model` với `{command_id}` để nhận gói model.
Không đọc Firestore trực tiếp và không nhận URL ngoài tùy ý. Download/progress/result đều kiểm tra
registry, enabled, tổ chức, thiết bị và command hiện hành. Model không public, trừ gói mẫu mặc định.

Trạng thái: `queued → downloading → loading → succeeded/failed`, hoặc `cancelled` trước loading.
ESP gọi `/api/device/model-result` với status. Trước khi SPI được phép nạp, ESP phải nhận xác nhận
server cho `loading`; vì vậy hủy lệnh thắng trước bước này ngăn việc nạp. Khi đã loading không được hủy.
Kết quả thành công phải có đúng version/SHA, model_valid=true, protocol_error=load_error=0, run_enabled=false.
Server chỉ ghi `active_model` sau kết quả đó. Trường này là lần xác nhận nạp, không phải trạng thái phần cứng liên tục.
Heartbeat có thêm map `fpga` từ đọc SPI: spi_ready, model_valid, active_version, protocol_error, load_error, run_enabled.

## Flash, mất mạng và reboot

- HTTPS worker chỉ tải/kiểm tra/lưu file. Sketch/main task là bên duy nhất dùng SPI, nên không xen lệnh với đọc FIFO/Serial.
- Model được ghi `/models/<commandId>.bin.tmp`, flush, đọc lại kiểm tra rồi rename sang `.bin`. File có checksum header riêng, CRC dữ liệu và SHA-256. Model cache dùng cùng LittleFS nhưng tách khỏi `/q` alert outbox; không có partition mới.
- Con trỏ active/previous, phase, ID lệnh và kết quả nằm trong blob NVS `model-state` có CRC. File active cũ không bị ghi đè khi tải. Chỉ chuyển active sau khi FPGA xác nhận và journal ghi thành công; giữ bản trước và model compiled dự phòng.
- Trước SPI, lưu phase Applying bền vững. Kết quả mạng bị mất được gửi lại, không nạp lại cùng lệnh đã kết thúc. Ready sau reboot phải được server cho phép lại; Applying bị gián đoạn trở thành failed/interrupted, không tự chạy lại candidate, và thử khôi phục cache/default với enforcement thấp.
- Khi FPGA không có model, firmware ưu tiên cache đã xác minh, sau đó model compiled. Lệnh Serial `m` cũng dùng thứ tự đó. Nếu nạp/commit thất bại, thử ABORT và khôi phục cache/default; không bảo đảm khôi phục được nếu FPGA/flash/dây đang lỗi. Xem log và heartbeat thực tế.
- Không ACK/xóa alert để nạp model. Mạng chậm hoặc nạp SPI có thể trì hoãn xử lý; FIFO/outbox vẫn hữu hạn. Chọn thời điểm ít traffic để cập nhật. Không format outbox để sửa lỗi model.
- Nếu không thể lưu journal, firmware không bắt đầu SPI. Khi NVS/flash hỏng, khả năng giữ kết quả qua reboot cũng bị giới hạn; cần chẩn đoán storage trước khi phát thêm lệnh.

## Kiểm thử

```powershell
npm run test:models
npm run test:alerts
npm run test:runtime
npm run build
```

Kiểm thử chỉ dùng emulator `demo-lastdance`, không nạp FPGA và không tạo lệnh trên Firebase thật.
Trên board cần thử: model mẫu → version/SHA đúng → RUN_ENABLE=0; mất Wi-Fi khi tải/gửi kết quả;
reboot ESP trước và trong lúc SPI; reset FPGA sau một lần cập nhật thành công; ABI/checksum sai;
hai lệnh đồng thời; hủy khi downloading. Xác minh alert persist/delivered vẫn chạy sau cập nhật.
Build/compile không thay thế các thử nghiệm phần cứng và cắt nguồn này.
