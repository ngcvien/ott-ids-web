# OTT-IDS Alerts

## Biểu đồ dashboard

Mục **Góc nhìn cảnh báo** gồm diễn biến tổng/Class 1 theo 12 khoảng, tỷ lệ phân loại
và phân bố giao thức. Dùng cùng listener tối đa 100 cảnh báo mới nhất của thiết bị
đang chọn, không tạo dữ liệu mẫu hoặc thêm truy vấn Firestore. Chọn toàn bộ mẫu,
15 phút, 1 giờ hoặc 24 giờ; các cửa sổ gần nhất tính lại mỗi 30 giây theo đồng hồ máy xem web.
Thống kê theo `received_at` của server, không theo timestamp bộ đếm phần cứng.

Đây là thống kê mẫu cảnh báo đã tải, không phải lịch sử đầy đủ, lượng packet hoặc
băng thông mạng. Khi đạt 100 bản ghi sẽ có nhãn giới hạn; mốc trống không chứng minh
mạng không có tấn công. Class khác không tự được gán là lưu lượng bình thường.
Class 1 và hành động Drop được đếm riêng. Bộ lọc tìm kiếm của bảng không áp dụng cho biểu đồ.
Có trạng thái trống/cache/lỗi, thanh kéo mốc thời gian hỗ trợ điện thoại/bàn phím,
và bảng số liệu có thể mở để đọc từng khoảng. Kiểm tra `npm run test:charts` và `npm run build`.

## Thuật ngữ giao diện

Web dùng **lõi xử lý IDS / lõi IDS** để giới thiệu định hướng vi mạch của dự án.
FPGA là nền tảng kiểm thử hiện tại, được giữ trong tài liệu kỹ thuật. Các tên trường
`fpga`, mã lỗi `fpga_not_ready`/`fpga_load_failed` và giao thức ESP vẫn giữ nguyên
để tương thích dữ liệu, được ánh xạ sang nhãn lõi xử lý trên giao diện.

## Nạp model FPGA từ xa

Đã có upload model ABI 1, kiểm tra CRC/SHA, phát lệnh theo thiết bị và lịch sử kết quả
trong trang **Thiết bị**. Xem [hướng dẫn triển khai, đóng gói và khôi phục model](MODEL_DEPLOYMENT_VI.md).
Cần deploy web + Firestore Rules mới, rồi nạp firmware ESP `ott-ids-1.2.0`.

## Chi tiết cảnh báo

Bấm một dòng trên dashboard để mở inspector (bàn phím: Tab đến dòng, Enter hoặc Space). Desktop hiển thị
dialog; điện thoại dùng toàn màn hình. Có nút Đóng/Quay lại và hỗ trợ Escape, điều
hướng bằng bàn phím; trang phía sau không thao tác được khi đang mở.

Inspector theo dõi riêng document đã chọn bằng Firestore listener, trong quyền đọc
owner/viewer hiện có. Cảnh báo mới đẩy bản ghi khỏi 100 dòng vẫn xem được chi tiết;
khi bản ghi bị xóa hoặc mất quyền, nội dung cũ được bỏ và hiển thị trạng thái tương ứng.
Dữ liệu cache được ghi rõ. Listener dừng khi đóng, đổi thiết bị hoặc đăng xuất.

Thông tin gồm Class/hành động, IP/cổng nguồn-đích, protocol, thời gian server nhận,
timestamp FPGA, Event ID, Boot ID, mã document, ingress, model version (decimal/hex),
tree error/steps và latency cycles. Class 1 là tấn công, Monitor không đồng nghĩa
đã chặn; Drop chỉ phản ánh hành động FPGA báo trong bản ghi. Không suy diễn tên hoặc
ý nghĩa cho Class khác, mã cổng hay mã lỗi cây. Timestamp FPGA không phải Unix time,
latency cycles không phải độ trễ mạng. Event ID giữ nguyên chuỗi uint64.

Mục JSON cho phép sao chép các trường cảnh báo đã chọn lọc, không kèm hash chống
trùng hoặc field nội bộ. Mở chi tiết có thêm lượt đọc document; không cần API,
Firestore Rules, cấu hình Firebase hoặc firmware mới. Kiểm tra `npm run test:details`
và `npm run build` trước khi đẩy bản web mới.

## Runtime Firebase Admin trên Vercel

Giữ Firebase Admin 14.5.1. Override riêng `jwks-rsa → jose` sang **5.10.0** trong
`package.json` và commit cả `package-lock.json`. `jwks-rsa` 4.1.0 gọi `require('jose')`,
trong khi jose 6 chỉ có ESM; Vercel mặc định tắt `require(ESM)`, khiến module Auth
lỗi ngay lúc tải và làm cả API alerts/heartbeat trả 500 vì dùng chung module Admin.
Override không thay Firebase SDK phía browser hoặc jose của Firebase CLI.

`npm run build` tự chạy `test:runtime` trước khi build: tắt `require(ESM)` để kiểm tra
việc nạp App/Firestore/Auth và xác minh chữ ký RSA bằng khóa sinh tại máy qua JWKS.
Không sử dụng credential hay dịch vụ thật. Giữ kiểm thử này khi cập nhật dependency;
chỉ bỏ override sau khi upstream tương thích và kiểm thử vẫn qua.
Tham khảo [lỗi upstream](https://github.com/auth0/node-jwks-rsa/issues/507) và
[cấu hình Node của Vercel](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration#experimental-nodejs-require-of-es-module).

Khi deploy bản sửa, không cần đổi biến Firebase/device key hoặc nạp lại ESP.
Sau khi Vercel Ready, POST không có device key tới `/api/device/heartbeat` phải trả
401 JSON thay vì 500; ESP có key đúng tự thử lại vào kỳ heartbeat tiếp theo.

## Heartbeat và danh sách thiết bị

- Mở `/dashboard/devices` hoặc mục **Thiết bị** sau khi đăng nhập. Dữ liệu cách ly theo membership hiện có; owner và viewer đều xem được, browser không được ghi telemetry.
- ESP32 gửi `POST /api/device/heartbeat` sau khi Wi-Fi/NTP sẵn sàng, sau đó mỗi 60 giây cộng jitter 0–5 giây. Dùng cùng `X-Device-ID` và `X-Device-Key` với API cảnh báo. URL heartbeat tự suy ra từ `OTT_API_URL`, không cần đổi cấu hình key/Wi-Fi.
- Body gồm `firmware_version`, `uptime_ms`, `wifi_rssi_dbm`, `free_heap_bytes`, `outbox_pending`, `outbox_rejected`, `outbox_capacity`, `storage_ready`. Không nhận `orgId`, thời gian server hoặc trường lạ từ thiết bị.
- Server xác thực registry và cập nhật `heartbeat` cùng `last_heartbeat_at` (server Timestamp) trên document `organizations/{orgId}/devices/{deviceId}`. Giữ nguyên name/location; không tạo alert hoặc lịch sử heartbeat. Request lặp trong 45 giây trả `accepted:true, updated:false`; kiểm tra key và trạng thái enabled trước khi giới hạn ghi. Đây là giới hạn ghi telemetry, không thay thế giới hạn request ở hạ tầng.
- Online: heartbeat trong 90 giây; Chậm heartbeat: trên 90 đến 180 giây; Offline: trên 180 giây. Tính lại mỗi 10 giây ngay cả khi Firestore không gửi snapshot mới. Firmware cũ chưa có heartbeat hiện **Chưa có heartbeat**. Dữ liệu cache hiện **Chưa xác minh**. Đồng hồ máy xem web cần đúng giờ.
- Đây là trạng thái ESP32 ↔ server, không chứng minh FPGA hoặc enforcement đang hoạt động. Số liệu outbox/heap/uptime là tại heartbeat cuối, không phải giá trị liên tục. Lỗi storage không ngăn gửi heartbeat, nhưng firmware chưa khởi tạo được identity hoặc worker thì không thể gửi.
- Mỗi thiết bị chạy liên tục tạo khoảng 1.440 heartbeat/ngày trước jitter, tương ứng số request và tối đa số lần cập nhật document, cộng các reads xác thực. Mỗi dashboard đang mở có thể phát sinh reads khi telemetry thay đổi; không ghi mỗi giây.

Thứ tự đưa vào dùng: **deploy web trước → nạp firmware mới sau**. Không cần thêm biến môi trường Vercel, không đổi Firestore Rules hoặc partition, không cần format outbox. Sau đó xem log `NET: heartbeat accepted.` và trang Thiết bị. Bản firmware cũ vẫn gửi cảnh báo như trước.

Kiểm tra local: `npm run test:presence`, `npm run test:alerts` (Firestore emulator/Java 21+) và `npm run build`. Các kiểm thử tự động không gửi heartbeat lên Firebase thật.

## Trang giới thiệu

Trang chủ `/` giới thiệu OTT-IDS; đăng nhập và dashboard cảnh báo nằm tại `/dashboard`.
Trang giới thiệu dùng GSAP ScrollTrigger cho hiệu ứng xuất hiện, parallax và luồng kết nối theo cuộn.
GSAP chỉ tải trên trang giới thiệu, có cleanup khi rời trang và tôn trọng `prefers-reduced-motion`.
Bố cục chuyển sang một cột trên điện thoại, có menu thu gọn và không khóa cuộn.
Các số liệu trong phần xem trước dashboard được ghi rõ là minh họa, không đọc hay tạo cảnh báo Firebase.

## Hiển thị tấn công và xóa cảnh báo

- `class_id: 1` hiển thị **Tấn công · Class 1** màu đỏ, tô nhẹ hàng dữ liệu và được đếm trong ô thống kê tấn công.
- Cảnh báo Class 1 mới của thiết bị đang chọn tạo một hiệu ứng đỏ toàn màn hình trong 1,8 giây. Giãn cách tối thiểu 8 giây khi tấn công liên tục; lịch sử khi mở trang, đổi thiết bị hoặc tải bù sau khi xóa không kích hoạt hiệu ứng. Với `prefers-reduced-motion`, chỉ hiện viền đỏ tĩnh ngắn.
- Owner có nút **Xóa cảnh báo (N)**, cần xác nhận. Nút chỉ xóa các dòng đang hiển thị theo bộ lọc, tối đa 100 dòng của thiết bị đang chọn. Cảnh báo mới trong lúc xóa được giữ lại; lịch sử cũ hơn có thể tải bù vào danh sách.
- `DELETE /api/alerts` nhận `{orgId, deviceId, ids}` và Firebase ID token trong `Authorization: Bearer …`. Server kiểm tra token (cả thu hồi phiên), role owner từ membership chính thức và xóa trong transaction. Viewer không có quyền xóa; client SDK vẫn không được ghi trực tiếp Firestore.
- Mỗi cảnh báo đã xóa giữ một receipt riêng tại `organizations/{orgId}/devices/{deviceId}/alertReceipts/{alertId}` gồm hash và thời gian xóa. Receipt chỉ dùng trên server để ESP gửi lại cùng sự kiện không tạo lại cảnh báo; không giữ IP hoặc dữ liệu gói tin đã xóa. API nhận cảnh báo đọc thêm receipt để kiểm tra chống trùng.

Kiểm tra thay đổi bằng `npm run test:attention`, `npm run test:alerts` (Java 21+, chỉ emulator) và `npm run build`.

Web Next.js riêng tại `web/`; backend FastAPI cũ vẫn ở thư mục cha.

Đã triển khai: đăng nhập email/password Firebase, đăng xuất, chọn nhóm và thiết bị,
đọc realtime 100 cảnh báo mới nhất, trạng thái tải/rỗng/lỗi, Firestore Rules cách ly
khách hàng. Bước 2 bổ sung API nhận alert, cấp/đổi/khóa device key và gửi thử có chủ ý.
Firmware Wi-Fi và deploy Vercel là các bước tiếp theo. Không có dữ liệu cảnh báo mẫu
trong giao diện.

## Chạy local

Yêu cầu Node.js 24. Trong thư mục này:

```powershell
npm ci
# Nếu chưa có .env.local:
Copy-Item .env.example .env.local
# Điền đủ 4 giá trị Firebase từ Project settings > Your apps.
npm run dev
```

Mở http://localhost:3000. Project hiện cấu hình là `ott-ids`, authDomain dùng
`ott-ids.firebaseapp.com`. `.env.local` bị gitignore. NEXT_PUBLIC là cấu hình web
công khai, không dùng để cấp quyền; không đặt service-account key trong các biến này.
Thay đổi NEXT_PUBLIC cần khởi động lại dev server hoặc build/deploy lại.

Trong Firebase Authentication, bật Email/Password. Kiểm tra Authorized domains
có `localhost`; sau khi deploy thêm domain Vercel đang dùng. Dùng tài khoản đã tạo
trên Firebase, không dùng tài khoản admin/client của FastAPI cũ.

## Bật phân quyền thật

Đăng nhập Firebase CLI bằng tài khoản sở hữu project rồi deploy rules:

```powershell
npm run firebase:login
npm run firebase:rules -- --project ott-ids
```

Hoặc copy `firestore.rules` vào Firebase Console > Firestore > Rules > Publish.
Không chọn rules cho phép đọc/ghi công khai.

Quyền quản trị trên cloud chưa được cấp cho phiên làm việc này. Có thể tạo các
document dưới đây bằng Firebase Console (thao tác quản trị đáng tin cậy), không cần
gửi service-account key vào chat:

| Document path | Fields |
| --- | --- |
| `organizations/lastdance` | `name` (string): `LastDance` |
| `organizations/lastdance/members/eK22JZAClnQvG0mmh4sEe6lmy4L2` | `role` (string): `owner` |
| `users/eK22JZAClnQvG0mmh4sEe6lmy4L2/memberships/lastdance` | `name` (string): `LastDance`, `role` (string): `owner` |
| `organizations/lastdance/devices/IDS-0001` | `name` (string): `ESP32 đầu tiên`, `deviceId` (string): `IDS-0001` |

Đăng ký document thiết bị chỉ giúp nó xuất hiện trên dashboard, chưa cấp credential
để gửi dữ liệu. UID được dùng nguyên bản, không có dấu `\` cuối tin nhắn.
Tài khoản chưa được gán sẽ thấy trạng thái chưa có quyền/thiết bị, không có quyền
mặc định với các nhóm khác.

Có thể thay thao tác tạo document bằng script quản trị sau khi đã thiết lập
Application Default Credentials có quyền Firebase Auth và Firestore trên project:

```powershell
npm run bootstrap -- --uid eK22JZAClnQvG0mmh4sEe6lmy4L2 --org lastdance --name LastDance --device IDS-0001
```

Nếu dùng file service account, giữ file ngoài repo và đặt đường dẫn trong biến
`GOOGLE_APPLICATION_CREDENTIALS` của môi trường local. `firebase login` phục vụ CLI,
không tự cung cấp Application Default Credentials cho script Admin SDK. Script này
cấp vai trò owner nên chỉ chạy từ máy quản trị; không được làm thành API public.

## Cấu trúc và hợp đồng dữ liệu

```text
users/{uid}/memberships/{orgId}       # chỉ mục khám phá nhóm, admin ghi
organizations/{orgId}/members/{uid} # nguồn quyết định quyền: owner/viewer
organizations/{orgId}/devices/{deviceId}
  alerts/{alertId}
```

Chỉ mục memberships không quyết định quyền đọc cảnh báo. Xóa document members sẽ
thu hồi quyền truy cập cả khi chỉ mục memberships còn tồn tại. Trình duyệt chỉ đọc;
owner/viewer ở bản đầu chưa có quyền chỉnh sửa bằng client SDK. API server của bước
tiếp theo sẽ tự kiểm tra device credential trước khi ghi bằng Firebase Admin SDK.

Alert giữ tên trường của server cũ: `class_id`, `src_ip`, `dst_ip`, `src_port`,
`dst_port`, `protocol`, `action`, `model_version`. `received_at` bắt buộc là Firestore
Timestamp do server ghi để query sắp xếp được; document thiếu field này không xuất
hiện trong query. `event_id` dùng string; bước tiếp theo sẽ bổ sung `boot_id` và
`sequence` cùng ID document ổn định để chống trùng khi ESP retry/reset.

## Kiểm tra

```powershell
npm run build
npm run typecheck
# Firestore emulator cần Java 21+, lệnh java trên PATH cũng phải trỏ Java 21+.
npm run test:rules
```

Test rules chỉ dùng project emulator `demo-lastdance`, không đụng dữ liệu `ott-ids`:
đọc nhóm của mình, từ chối nhóm khác/anonymous, từ chối tự cấp quyền và ghi alert,
khóa device credentials, query có giới hạn và thu hồi quyền.

## API nhận cảnh báo — bước 2

Đã có `POST /api/device/alerts` và script cấp key riêng. API lấy nhóm sở hữu từ
registry trên server; không chấp nhận `orgId` hoặc thời gian nhận do ESP tự khai.
Không cần đổi Firestore Rules ở bước này: browser tiếp tục chỉ đọc và không được
đọc collection `deviceCredentials`. API dùng quyền Firebase Admin và tự xác thực.

### Cấp key cho thiết bị đã bootstrap

Trong `web`, dùng credential quản trị đang cấu hình qua `GOOGLE_APPLICATION_CREDENTIALS`:

```powershell
npm run device:key -- --org lastdance --device IDS-0001
```

Lệnh lưu hash SHA-256 vào `deviceCredentials/IDS-0001` và lưu secret gốc trong file
JSON mới ở `web/.device-secrets/`. Terminal chỉ in đường dẫn; thư mục này đã được
gitignore. Mở file trên máy để lấy `deviceId`, `deviceKey` cho firmware. Không đưa
file này lên Git/Vercel hoặc vào chat. Device ID là duy nhất toàn hệ thống.

Chạy lại bình thường không thay key cũ. Các thao tác quản trị có chủ ý:

```powershell
# Thay key cũ, đồng thời bật lại thiết bị; cần cập nhật key trên ESP32.
npm run device:key -- --org lastdance --device IDS-0001 --rotate
# Chặn ngay cả những lần gửi lại alert cũ, không xóa lịch sử.
npm run device:key -- --org lastdance --device IDS-0001 --disable
```

### Contract ESP32

```http
POST /api/device/alerts
Content-Type: application/json
X-Device-ID: IDS-0001
X-Device-Key: <deviceKey từ file được cấp>
```

```json
{
  "boot_id": "6cf4eb74-5f53-489b-8618-1a80bb4a9ef7",
  "event_id": "42",
  "timestamp_ms": 123456,
  "model_version": 16777217,
  "class_id": 1,
  "ingress_port": 2,
  "src_ip": "192.168.50.11",
  "dst_ip": "192.168.50.12",
  "src_port": 41000,
  "dst_port": 40000,
  "protocol": 17,
  "action": "monitor",
  "tree_error": 0,
  "tree_steps": 9,
  "latency_cycles": 9
}
```

`boot_id` gồm 8–64 chữ/số/dấu gạch ngang/gạch dưới. Đổi nó khi bắt đầu một phiên
sequence mới, gồm cả lúc FPGA reset sequence dù ESP32 vẫn chạy. `event_id` nên là
chuỗi số nguyên uint64; API cũng nhận số JS an toàn nhưng từ chối số bị mất độ chính
xác. Giữ nguyên cả boot ID, event ID và nội dung trong outbox cho mọi lần retry.
Gửi lại bản ghi cũ sau reboot vẫn dùng identity gốc, không gán boot ID mới.

Payload tối đa 16 KiB, IPv4 hợp lệ, các trường số theo phạm vi schema. Protocol khác
TCP/UDP được chuẩn hóa port về 0. `received_at` là Firestore server Timestamp.
API không ghi heartbeat mỗi lần nhận; một alert mới dùng một document write cùng
các document reads phục vụ xác thực/chống trùng. Chưa có rate limit/quota per-device
hoặc chính sách xóa lịch sử, cần bổ sung trước khi mở cho lưu lượng lớn.

| HTTP | Ý nghĩa | Hành vi ESP32 |
| --- | --- | --- |
| 200, `accepted:true`, `duplicate:false` | Đã lưu | Xóa bản ghi khỏi outbox |
| 200, `accepted:true`, `duplicate:true` | Đã nhận trước đó | Xóa bản ghi khỏi outbox |
| 401 | ID/key sai | Giữ bản ghi, kiểm tra provisioning |
| 403 | Thiết bị bị tắt hoặc registry thiếu | Giữ bản ghi, báo lỗi quản trị |
| 409 | Cùng identity nhưng nội dung khác | Giữ/cách ly bản ghi, sửa lỗi sequence |
| 400/413/415/422 | JSON/payload sai | Giữ/cách ly bản ghi, sửa format |
| 503 hoặc mất mạng/timeout | Chưa xác nhận lưu thành công | Retry cùng identity, backoff |

Các requests đồng thời được xử lý bằng Firestore transaction; retry không đổi
`received_at` của bản ghi đầu tiên. Đây không phải endpoint tương thích nguyên trạng
với bridge cũ: bridge/firmware hiện chưa gửi `boot_id`. Không đổi URL bridge sang API
mới trước khi bổ sung field này.

### Gửi thử có chủ ý

Khởi động `npm run dev`, đăng nhập dashboard rồi chạy ở terminal khác:

```powershell
npm run send:test-alert -- --credential ".device-secrets/<file-vua-cap>.json" --repeat
```

Lệnh tạo **một cảnh báo tổng hợp** vào Firestore của thiết bị để bạn kiểm tra dashboard.
Hai response lần lượt phải có `duplicate:false` và `duplicate:true`; chỉ một alert
xuất hiện. Mỗi lần chạy lệnh tạo identity mới. Không có test alert được tự gửi lên
cloud trong quá trình kiểm thử tự động. Thêm `--server https://<domain>` khi đã deploy.

```powershell
# Kiểm thử API với database emulator, không dùng key hoặc dữ liệu thật.
npm run test:ingestion
```

### Credential khi deploy Vercel

Chọn Root Directory `web`. Giữ nguyên 4 biến `NEXT_PUBLIC_FIREBASE_*` của web. Thêm
server-only `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
từ service account (project phải khớp). Private key nhận chuỗi có newline thật hoặc
ký tự `\n`; không thêm `NEXT_PUBLIC_`. Không dùng đường dẫn ổ D: trong
`GOOGLE_APPLICATION_CREDENTIALS` trên Vercel. Không upload JSON service account vào
source. API khởi tạo Admin SDK khi có request, không cần credential lúc build.

## Sau bước này

1. Hoàn tất cấu hình Firebase và tạo membership/device thật.
2. Kiểm tra đăng nhập với tài khoản của bạn.
3. Cấp device credential và kiểm tra API nhận cảnh báo đã triển khai ở bước 2.
4. Deploy Vercel (Root Directory: `web`), khai báo đủ NEXT_PUBLIC trước khi build.
5. Thêm Wi-Fi, TLS và outbox flash cho ESP32, kiểm thử gửi alert thật end-to-end.

Không cần persistent disk hay WebSocket server riêng cho web mới. Cảnh báo lưu ở
Firestore và đồng bộ trực tiếp bằng listener; mỗi dashboard mở sẽ tiêu thụ lượt đọc.
