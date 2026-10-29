E-READER PRO V11 - GIỌNG CAO CẤP + DỊCH VIỆT ↔ ANH
================================================

Chức năng kế thừa V10: EPUB, Word DOCX, tách từng câu, dịch/ẩn, tra từ nhanh IPA, loại từ, sổ tay, dấu trang, vị trí đọc, theme.

MỚI V11
- Cài đặt → Ngôn ngữ sách: Tiếng Việt (vi) và Dịch sang: Tiếng Anh (en) để dịch câu/từ/cụm từ Việt→Anh.
- Đọc thành tiếng: chọn Miễn phí (giọng hệ thống) hoặc Cao cấp (Google Cloud Text-to-Speech).
- Cloud TTS hỗ trợ tiếng Việt vi-VN và tiếng Anh en-US: Neural2 và Chirp 3 HD; chọn các giọng trong menu.
- Dùng API key TTS riêng, hoặc nút Dùng khóa dịch (phải bật cả Cloud Text-to-Speech API trong Google Cloud).
- Nhấn Nghe sách để phát từng phần của chương, nút Dừng để kết thúc; với nội dung được bôi đen hoặc trong popup, nút Nghe chỉ phát văn bản tương ứng.
- Google giới hạn 5000 byte/request; ứng dụng chia đoạn nhỏ hơn 3500 byte, xử lý chữ Việt nhiều byte.
- Các chương dài >12000 ký tự hỏi xác nhận vì có thể tính phí, không tự âm thầm gửi toàn sách.
- Người dùng chủ động chọn chế độ cao cấp trước khi gọi Google; không có API Key vẫn có thể dùng giọng miễn phí.
- Bản MP3 cao cấp trả về cho trình duyệt, không lưu trên server. Safari/iOS có thể yêu cầu nhấn Play trong thanh nghe sau khi tải âm thanh.

CÀI VERCEL
1. Giải nén ZIP, chép NỘI DUNG folder vào GỐC GitHub repository hiện tại (không bọc thư mục).
2. Bao gồm thư mục api (api/translate.js và api/tts.js), index.html, app.js, style.css, sw.js, icons và manifest.
3. Commit để Vercel tự deploy. Bật Cloud Text-to-Speech API trong Google Cloud Console và thiết lập quyền/hạn mức/billing.
4. Mở ứng dụng -> Cài đặt -> Chế độ cao cấp -> Nhập khóa -> chọn giọng -> Nghe thử.
5. Nên giới hạn các API được phép dùng, ràng buộc và hạn mức key.

LƯU Ý
- API key tùy chọn chỉ được lưu trong trình duyệt nếu tích Ghi nhớ; dùng Vercel cho proxy API.
- Dịch vụ Google Cloud TTS có thể tính phí; nghe thử cũng là một lần gọi API.
- Giọng Chirp 3 HD không dùng thanh tốc độ (Google không hỗ trợ speakingRate trong API model này); giọng hệ thống và Neural2 có chỉnh tốc độ.
- API Cloud TTS và Gemini TTS không phải cùng một endpoint: đây là Google Cloud Text-to-Speech.
- Phải có mạng để tạo âm thanh cao cấp; miễn phí có thể hoạt động offline tùy thiết bị.
- DOC cũ, PDF quét ảnh/OCR chưa được hỗ trợ.
- Chưa xác minh trực tiếp với khóa Google Cloud thực và trình duyệt iPhone thực tế.
