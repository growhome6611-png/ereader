BẢN V13 — SPOTIFY BILINGUAL (KHÔNG YOUTUBE / BÀI TẬP)

- Đã gỡ toàn bộ tính năng kết nối YouTube, trang YouTube, quyền youtube.readonly và trình phát YouTube.
- Đã gỡ toàn bộ bài tập lời bài hát: nút 🎓, hộp luyện tập, tạo câu hỏi, lưu/đồng bộ bài tập và phần Gemini riêng cho bài tập.
- Giữ nguyên Spotify Player, tìm kiếm và thư viện nhạc, đồng bộ lời bài hát, tra từ, dịch, đồng bộ bản dịch Google Drive.
- Mã nguồn đã loại bỏ xử lý bài tập và YouTube; không xóa dữ liệu bản dịch của người dùng trong localStorage/Drive.
- Cập nhật cache PWA thành phiên bản v13 để thay thế giao diện cũ.

CÀI ĐẶT: tải ZIP về, giải nén rồi đưa các file trong thư mục Spotify-Bilingual-Lyrics-main lên repository GitHub/Vercel đang dùng; chọn ghi đè các file cũ. Sau khi deploy, đóng/mở lại PWA; nếu còn cache cũ, mở Chrome để tải lại trang mới.

--- THÔNG TIN BẢN TRƯỚC ---
Spotify Bilingual Lyrics V5

Nang cap:
- Spotify Web Playback SDK: phat nhac truc tiep trong app
- Play/Pause, Previous, Next, seek, volume
- Tim kiem, Thu vien, Playlist/BST
- Lyrics dong bo va dich song ngu

YEU CAU:
1. Deploy tren HTTPS/Vercel.
2. Redirect URI trong Spotify Developer Dashboard phai trung URL app.
3. Sau khi cap nhat V5, ngat ket noi Spotify va ket noi lai de cap them scope streaming + user-modify-playback-state.
4. Web Playback SDK yeu cau tai khoan Spotify Premium.
5. Tren iPhone, sau khi chuyen thiet bi phat co the can cham nut Play mot lan.


V8: thêm thanh điều hướng đáy kiểu Spotify và Google Drive Sync cho bản dịch. Cần tạo Google OAuth Client ID loại Web application, thêm domain Vercel vào Authorized JavaScript origins, bật Google Drive API, và dùng scope drive.file.

V11.1: Spotify API limit 10 for search, playlists, albums, library and following; next-page requests clamped to 10.

V11.9 (2026-11-02)
- Khôi phục bảng Google Drive Sync đầy đủ vào cửa sổ Cài đặt.
- Sửa cửa sổ cài đặt cuộn độc lập, giới hạn chiều cao theo màn hình điện thoại.
- Nút Lưu và Đóng luôn nằm trong cửa sổ, tránh bị thanh điều hướng che.
- Giữ nguyên các ID và hàm đồng bộ của V11.8, không xóa dữ liệu cục bộ.

V11.13 - LUYEN TAP QUA LOI BAI HAT
- Nhan nut mu tot nghiep (🎓) tren thanh dieu khien.
- Tao 5/10/20 cau: dien tu, trac nghiem, sap xep, nghe chep chinh ta.
- Tao tu dong tren thiet bi khong can API, hoac chon AI Gemini va nhap Gemini API key.
- Cho phep them, sua, xoa cau hoi, cham diem va luu ket qua tren thiet bi.
- Nut Dong bo bai tap: luu tai tep JSON rieng trong thu muc Spotify Bilingual Lyrics tren Drive.
- Neu phat hien ban tren Drive khac voi may, ung dung khong ghi de tu dong.
- Phat lai doan nhac yeu cau Spotify Premium, ket noi hop le va loi co moc thoi gian.
- Khong thay doi du lieu loi bai hat va ban dich hien co.

V11.15: Playback controls now target active Spotify Connect device via Web API; fixes idle Web SDK no-list-loaded error.

V12 YouTube OAuth diagnostic update (2026-11-12):
- YouTube connect now reports missing/invalid OAuth Client ID, blocked popup, cancelled popup, missing Google Identity Services and timeout.
- The connection button reflects token state; Spotify, exercises and Drive code preserved.
- OAuth YouTube readonly scope may require Google verification in Production. For private testing, use Google Auth Platform > Audience > Testing and add your Google account as a test user, then retry.
- YouTube Data API v3 must be enabled; authorized JavaScript origin must match the deployed HTTPS origin exactly.


V12.2 - YOUTUBE OAUTH SCOPE FIX
- YouTube OAuth requests youtube.readonly only, with include_granted_scopes=false.
- Google Drive OAuth requests drive.file only, with include_granted_scopes=false.
- Redirect OAuth uses a per-request state verified on return.
- Refresh service worker cache.
- Google Cloud OAuth Web Client must authorize the site's exact origin and redirect URI.

V13.1: Bottom-right saved vocabulary tab. Save from word lookup, search, edit/delete, speech playback and JSON export. Stored locally in browser (not synced to Drive).
